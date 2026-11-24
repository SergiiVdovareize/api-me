import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { createHash } from 'crypto';
import * as net from 'net';
import { DownloadResult } from 'mediasnap';
import { RedisReader } from 'src/common/helpers/redisReader';
import { MemeDownloader } from '../downloader.interface';
import { SAVERAPI_CONSTANTS } from './saverapi.constants';
import { SaverapiError } from './saverapi.error';

interface SaverapiResponseBody {
  error?: boolean;
  hosting?: string;
  type?: string;
  download_url?: string;
  thumb?: string;
  caption?: string;
  message?: string;
}

@Injectable()
export class SaverapiDownloader implements MemeDownloader {
  readonly name = 'saverapi';
  private readonly logger = new Logger(SaverapiDownloader.name);

  constructor(
    @Optional() private readonly configService?: ConfigService,
    @Optional() private readonly redisReader?: RedisReader
  ) {}

  async steal(url: string): Promise<DownloadResult> {
    if (this.configService?.get<string>('ENABLE_SAVERAPI') === 'false') {
      throw new SaverapiError('DISABLED', 'SaverAPI integration is disabled', true);
    }

    const apiKey = this.configService?.get<string>('SAVERAPI_KEY')?.trim();
    if (!apiKey) {
      throw new SaverapiError('DISABLED', 'SAVERAPI_KEY is not configured', true);
    }

    const normalizedUrl = this.validateAndNormalizeSourceUrl(url);

    if (await this.isCircuitOpen()) {
      throw new SaverapiError(
        'CIRCUIT_OPEN',
        'SaverAPI circuit breaker is open due to quota or rate limit',
        true
      );
    }

    const cacheKey = this.buildCacheKey(normalizedUrl);
    const cached = await this.readCache(cacheKey);
    if (cached) {
      return cached;
    }

    const endpoint = this.buildEndpointUrl(normalizedUrl);
    const timeoutMs = this.getTimeoutMs();

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'GET',
        cache: 'no-store',
        redirect: 'error',
        headers: {
          accept: 'application/json',
          'x-api-key': apiKey,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err: any) {
      const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      throw new SaverapiError(
        isTimeout ? 'PROVIDER_TIMEOUT' : 'PROVIDER_TEMPORARY_FAILURE',
        isTimeout ? `SaverAPI request timed out after ${timeoutMs}ms` : 'SaverAPI network error',
        true
      );
    }

    const body = await this.readBoundedJson(response);

    if (!response.ok) {
      await this.handleHttpError(response.status, body);
    }

    if (
      !body ||
      body.error !== false ||
      typeof body.download_url !== 'string' ||
      !this.isSafeExternalHttpsUrl(body.download_url)
    ) {
      throw new SaverapiError(
        'UPSTREAM_RESPONSE_INVALID',
        'SaverAPI returned an invalid or unsafe response payload',
        true
      );
    }

    const isImage = body.type === 'image' || body.type === 'photo';
    const result: DownloadResult = {
      success: true,
      platform: typeof body.hosting === 'string' && body.hosting ? body.hosting : 'unknown',
      title: typeof body.caption === 'string' && body.caption ? body.caption : null,
      description: null,
      thumbnail:
        typeof body.thumb === 'string' && this.isSafeExternalHttpsUrl(body.thumb)
          ? body.thumb
          : null,
      duration: null,
      media: [
        {
          type: isImage ? 'image' : 'video',
          url: body.download_url,
          quality: null,
          format: isImage ? 'jpg' : 'mp4',
          sizeMB: null,
        },
      ],
    };

    await this.writeCache(cacheKey, result);
    return result;
  }

  private validateAndNormalizeSourceUrl(rawUrl: string): string {
    if (
      !rawUrl ||
      typeof rawUrl !== 'string' ||
      rawUrl.length > SAVERAPI_CONSTANTS.MAX_URL_LENGTH
    ) {
      throw new SaverapiError('UNSUPPORTED_URL', 'Invalid or too long URL', false);
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl.trim());
    } catch {
      throw new SaverapiError('UNSUPPORTED_URL', 'Malformed URL', false);
    }

    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
      throw new SaverapiError(
        'UNSUPPORTED_URL',
        'URL scheme, port, or credentials not allowed',
        false
      );
    }

    const hostname = parsed.hostname.toLowerCase();
    const isAllowed = SAVERAPI_CONSTANTS.ALLOWED_DOMAINS.some(
      domain => hostname === domain || hostname.endsWith(`.${domain}`)
    );
    if (!isAllowed) {
      throw new SaverapiError('UNSUPPORTED_URL', `Unsupported domain: ${hostname}`, false);
    }

    parsed.hash = '';
    return parsed.toString();
  }

  private buildEndpointUrl(sourceUrl: string): URL {
    const rawEndpoint =
      this.configService?.get<string>('SAVERAPI_ENDPOINT')?.trim() ||
      SAVERAPI_CONSTANTS.DEFAULT_ENDPOINT;
    const endpoint = new URL(rawEndpoint);
    endpoint.searchParams.set('url', sourceUrl);
    return endpoint;
  }

  private getTimeoutMs(): number {
    const raw = Number(this.configService?.get<string>('SAVERAPI_TIMEOUT_MS'));
    return Number.isFinite(raw) && raw > 0 ? raw : SAVERAPI_CONSTANTS.DEFAULT_TIMEOUT_MS;
  }

  private async readBoundedJson(response: Response): Promise<SaverapiResponseBody | null> {
    const contentLengthHeader = response.headers.get('content-length');
    if (contentLengthHeader) {
      const contentLength = Number(contentLengthHeader);
      if (Number.isFinite(contentLength) && contentLength > SAVERAPI_CONSTANTS.MAX_RESPONSE_BYTES) {
        throw new SaverapiError(
          'UPSTREAM_RESPONSE_INVALID',
          'SaverAPI response exceeded maximum allowed size',
          true
        );
      }
    }

    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > SAVERAPI_CONSTANTS.MAX_RESPONSE_BYTES) {
      throw new SaverapiError(
        'UPSTREAM_RESPONSE_INVALID',
        'SaverAPI response exceeded maximum allowed size',
        true
      );
    }

    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text) as SaverapiResponseBody;
    } catch {
      return null;
    }
  }

  private async handleHttpError(status: number, body: SaverapiResponseBody | null): Promise<never> {
    if (status === 401 || status === 403) {
      Sentry.captureMessage(`SaverAPI authentication/plan failure (HTTP ${status})`, {
        level: 'error',
      });
      throw new SaverapiError(
        'PROVIDER_AUTH_FAILED',
        `SaverAPI auth/plan error (HTTP ${status})`,
        true
      );
    }

    if (status === 402 || status === 429) {
      await this.openCircuitBreaker();
      throw new SaverapiError(
        status === 402 ? 'PROVIDER_QUOTA_EXHAUSTED' : 'PROVIDER_RATE_LIMIT',
        `SaverAPI quota/rate limit reached (HTTP ${status})`,
        true
      );
    }

    if (status === 400) {
      const msg = String(body?.message || '').toLowerCase();
      if (msg.includes('private')) {
        throw new SaverapiError('PRIVATE_CONTENT', 'Content is private', false);
      }
      if (msg.includes('paid') || msg.includes('subscriber') || msg.includes('members')) {
        throw new SaverapiError('PAID_CONTENT', 'Content requires payment or membership', false);
      }
      if (msg.includes('unavailable') || msg.includes('deleted') || msg.includes('not found')) {
        throw new SaverapiError('VIDEO_UNAVAILABLE', 'Content is unavailable or deleted', false);
      }
      throw new SaverapiError('UNSUPPORTED_URL', 'SaverAPI rejected URL as unsupported', true);
    }

    throw new SaverapiError(
      'PROVIDER_TEMPORARY_FAILURE',
      `SaverAPI upstream failure (HTTP ${status})`,
      true
    );
  }

  isSafeExternalHttpsUrl(rawUrl: string): boolean {
    if (!rawUrl || typeof rawUrl !== 'string') {
      return false;
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl.trim());
    } catch {
      return false;
    }

    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
      return false;
    }

    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
      !host ||
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      return false;
    }

    const ipVersion = net.isIP(host);
    if (ipVersion === 4) {
      return !this.isPrivateIpv4(host);
    }
    if (ipVersion === 6) {
      return !this.isPrivateIpv6(host);
    }

    return true;
  }

  private isPrivateIpv4(ip: string): boolean {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(p => !Number.isInteger(p) || p < 0 || p > 255)) {
      return true;
    }
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }

  private isPrivateIpv6(ip: string): boolean {
    const normalized = ip.toLowerCase();
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80:') ||
      normalized.startsWith('::ffff:127.') ||
      normalized.startsWith('::ffff:10.') ||
      normalized.startsWith('::ffff:192.168.') ||
      normalized.startsWith('::ffff:169.254.')
    );
  }

  private buildCacheKey(normalizedUrl: string): string {
    const hash = createHash('sha256').update(normalizedUrl).digest('hex');
    return `${SAVERAPI_CONSTANTS.CACHE_REDIS_PREFIX}${hash}`;
  }

  private async isCircuitOpen(): Promise<boolean> {
    if (!this.redisReader) return false;
    try {
      const value = await this.redisReader.read(SAVERAPI_CONSTANTS.CIRCUIT_BREAKER_REDIS_KEY);
      return Boolean(value);
    } catch {
      return false;
    }
  }

  private async openCircuitBreaker(): Promise<void> {
    if (!this.redisReader) return;
    try {
      await this.redisReader.write(
        SAVERAPI_CONSTANTS.CIRCUIT_BREAKER_REDIS_KEY,
        '1',
        SAVERAPI_CONSTANTS.CIRCUIT_BREAKER_TTL_SECONDS
      );
      this.logger.warn(
        `Opened SaverAPI circuit breaker for ${SAVERAPI_CONSTANTS.CIRCUIT_BREAKER_TTL_SECONDS}s`
      );
    } catch (err) {
      this.logger.warn(`Failed to write SaverAPI circuit breaker: ${String(err)}`);
    }
  }

  private async readCache(key: string): Promise<DownloadResult | null> {
    if (!this.redisReader) return null;
    try {
      const raw = await this.redisReader.read(key);
      if (!raw) return null;
      const parsed: DownloadResult = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (parsed?.success && Array.isArray(parsed.media) && parsed.media.length > 0) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async writeCache(key: string, result: DownloadResult): Promise<void> {
    if (!this.redisReader) return;
    try {
      await this.redisReader.write(
        key,
        JSON.stringify(result),
        SAVERAPI_CONSTANTS.CACHE_TTL_SECONDS
      );
    } catch (err) {
      this.logger.warn(`Failed to cache SaverAPI result: ${String(err)}`);
    }
  }
}
