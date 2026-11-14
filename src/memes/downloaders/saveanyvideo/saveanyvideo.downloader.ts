import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DownloadResult } from 'mediasnap';
import { AnalyticsEvent } from 'src/analytics/analytics.events';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { RedisReader } from 'src/common/helpers/redisReader';
import { getMemeTypeFromUrl } from '../../meme-type.enum';
import { MemeDownloader } from '../downloader.interface';
import { SaveanyvideoAdapter, SaveanyvideoStatusReady } from './saveanyvideo.adapter';
import { SAVEANYVIDEO_CONSTANTS } from './saveanyvideo.constants';

interface TokenResponseBody {
  token?: string;
}

interface SubmitResponseBody {
  id?: string;
  status?: string;
  error?: string;
}

interface StatusResponseBody {
  status?: string;
  error?: string;
  size?: number;
  title?: string;
  kind?: string;
  count?: number;
}

@Injectable()
export class SaveanyvideoDownloader implements MemeDownloader {
  readonly name = 'saveanyvideo';
  private readonly logger = new Logger(SaveanyvideoDownloader.name);

  constructor(
    private readonly analyticsService: AnalyticsService,
    @Optional() private readonly redisReader?: RedisReader,
    @Optional() private readonly configService?: ConfigService
  ) {}

  async steal(url: string): Promise<DownloadResult> {
    if (this.configService?.get<string>('SAVEANYVIDEO_ENABLED') === 'false') {
      throw new Error('SaveAnyVideo integration is disabled');
    }

    const validatedUrl = this.validateUrl(url);
    const memeType = getMemeTypeFromUrl(validatedUrl);
    this.analyticsService.trackEvent(AnalyticsEvent.StealMeme, {
      memeUrl: validatedUrl,
      memeType,
    });

    await this.consumeGlobalQuota();

    const apiBase =
      this.configService?.get<string>('SAVEANYVIDEO_API_BASE') ||
      SAVEANYVIDEO_CONSTANTS.DEFAULT_API_BASE;

    const upstreamId = await this.createUpstreamJob(apiBase, validatedUrl);
    const readyStatus = await this.pollUntilReady(apiBase, upstreamId);

    return SaveanyvideoAdapter.toDownloadResult(
      readyStatus,
      upstreamId,
      apiBase,
      memeType.toLowerCase()
    );
  }

  private validateUrl(rawUrl: string): string {
    if (
      !rawUrl ||
      typeof rawUrl !== 'string' ||
      rawUrl.length > SAVEANYVIDEO_CONSTANTS.MAX_URL_LENGTH
    ) {
      throw new Error('Invalid or too long URL for SaveAnyVideo');
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error('Malformed URL for SaveAnyVideo');
    }

    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
      throw new Error('Unsupported URL scheme, credentials, or port for SaveAnyVideo');
    }

    const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
    const allowed = SAVEANYVIDEO_CONSTANTS.ALLOWED_DOMAINS.some(
      domain => host === domain || host.endsWith(`.${domain}`)
    );

    if (!allowed) {
      throw new Error(`Unsupported domain for SaveAnyVideo: ${host}`);
    }

    return parsed.toString();
  }

  private async consumeGlobalQuota(): Promise<void> {
    const redis = this.redisReader?.redis;
    if (!redis) {
      return;
    }

    const count = await redis.incr(SAVEANYVIDEO_CONSTANTS.RATE_LIMIT_REDIS_KEY);
    if (count === 1) {
      await redis.expire(
        SAVEANYVIDEO_CONSTANTS.RATE_LIMIT_REDIS_KEY,
        SAVEANYVIDEO_CONSTANTS.RATE_LIMIT_WINDOW_SECONDS
      );
    }

    if (count > SAVEANYVIDEO_CONSTANTS.GLOBAL_HOURLY_LIMIT) {
      this.logger.warn('SaveAnyVideo global hourly quota exceeded');
      throw new Error('SaveAnyVideo global hourly quota exceeded');
    }
  }

  private async getSessionToken(apiBase: string): Promise<{ token: string; phpSession: string }> {
    let lastError: unknown;

    // Retry once only on network failure or 5xx
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${apiBase}?action=token`, {
          method: 'GET',
          cache: 'no-store',
          redirect: 'error',
          signal: AbortSignal.timeout(SAVEANYVIDEO_CONSTANTS.TOKEN_TIMEOUT_MS),
        });
      } catch (networkErr) {
        lastError = networkErr;
        if (attempt === 0) {
          continue;
        }
        throw networkErr;
      }

      if (!res.ok) {
        const err = new Error(`SaveAnyVideo token HTTP ${res.status}`);
        if (res.status >= 500 && attempt === 0) {
          lastError = err;
          continue;
        }
        throw err;
      }

      const body = (await res.json()) as TokenResponseBody;
      const phpSession = this.extractPhpSession(res.headers);

      if (!/^[a-f0-9]{48}$/i.test(body?.token ?? '') || !phpSession) {
        throw new Error('SaveAnyVideo returned invalid session token or missing PHPSESSID');
      }

      return { token: body.token as string, phpSession };
    }

    throw lastError;
  }

  private extractPhpSession(headers: Headers): string | undefined {
    const setCookies =
      typeof headers.getSetCookie === 'function'
        ? headers.getSetCookie()
        : [headers.get('set-cookie')].filter((v): v is string => Boolean(v));

    return setCookies
      .flatMap(value => value.split(/,(?=[^;,]+=)/))
      .map(value => value.trim())
      .find(value => value.startsWith('PHPSESSID='))
      ?.split(';', 1)[0];
  }

  private async createUpstreamJob(apiBase: string, url: string): Promise<string> {
    // Allow at most one full exchange retry when upstream explicitly returns error: "session"
    for (let attempt = 0; attempt < 2; attempt++) {
      const { token, phpSession } = await this.getSessionToken(apiBase);

      const submitRes = await fetch(`${apiBase}?action=submit`, {
        method: 'POST',
        cache: 'no-store',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          cookie: phpSession,
        },
        body: JSON.stringify({ token, url }),
        signal: AbortSignal.timeout(SAVEANYVIDEO_CONSTANTS.SUBMIT_TIMEOUT_MS),
      });

      if (!submitRes.ok) {
        throw new Error(`SaveAnyVideo submit HTTP ${submitRes.status}`);
      }

      const result = (await submitRes.json()) as SubmitResponseBody;
      if (result?.error) {
        if (result.error === 'session' && attempt === 0) {
          this.logger.warn('SaveAnyVideo session error on submit, retrying exchange once');
          continue;
        }
        throw new Error(`SaveAnyVideo submit error: ${result.error}`);
      }

      if (result?.status !== 'working' || !/^[a-f0-9]{64}$/i.test(result?.id ?? '')) {
        throw new Error('SaveAnyVideo submit returned invalid job response');
      }

      return result.id as string;
    }

    throw new Error('SaveAnyVideo submit failed after session retry');
  }

  private async pollUntilReady(
    apiBase: string,
    upstreamId: string
  ): Promise<SaveanyvideoStatusReady> {
    const deadline = Date.now() + SAVEANYVIDEO_CONSTANTS.MAX_POLL_DURATION_MS;

    while (Date.now() < deadline) {
      const statusRes = await fetch(
        `${apiBase}?action=status&id=${encodeURIComponent(upstreamId)}`,
        {
          method: 'GET',
          cache: 'no-store',
          redirect: 'error',
          signal: AbortSignal.timeout(SAVEANYVIDEO_CONSTANTS.STATUS_TIMEOUT_MS),
        }
      );

      if (!statusRes.ok) {
        throw new Error(`SaveAnyVideo status HTTP ${statusRes.status}`);
      }

      const data = (await statusRes.json()) as StatusResponseBody;

      if (data?.error) {
        throw new Error(`SaveAnyVideo status error: ${data.error}`);
      }

      if (data?.status === 'ready') {
        return data as SaveanyvideoStatusReady;
      }

      if (data?.status !== 'working') {
        throw new Error(`SaveAnyVideo unexpected status: ${String(data?.status)}`);
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        break;
      }

      await new Promise(resolve =>
        setTimeout(resolve, Math.min(SAVEANYVIDEO_CONSTANTS.POLL_INTERVAL_MS, remaining))
      );
    }

    throw new Error('SaveAnyVideo job did not finish within polling timeout');
  }
}
