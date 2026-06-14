import { Injectable, Logger } from '@nestjs/common';
import { DownloadResult } from 'mediasnap';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { AnalyticsEvent } from 'src/analytics/analytics.events';
import { getMemeTypeFromUrl } from '../../meme-type.enum';
import { MemeDownloader } from '../downloader.interface';
import { sortMediaByQuality } from '../../utils/quality-sort';
import { VidssaveAdapter, VidssaveParseResponse } from './vidssave.adapter';
import { VidssaveTokenParser } from './vidssave.token-parser';
import { BlobService } from 'src/blob/blob.service';

@Injectable()
export class VidssaveDownloader implements MemeDownloader {
  readonly name = 'vidssave';
  private readonly logger = new Logger(VidssaveDownloader.name);
  private readonly cacheKey = 'vidssave-auth-token.json';

  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly tokenParser: VidssaveTokenParser,
    private readonly blobService: BlobService
  ) {}

  async steal(url: string): Promise<DownloadResult> {
    const memeType = getMemeTypeFromUrl(url);
    this.analyticsService.trackEvent(AnalyticsEvent.StealMeme, { memeUrl: url, memeType });

    try {
      let token: string | undefined;
      let isFromCache = false;

      try {
        const cached = await this.blobService.read(this.cacheKey);
        if (cached && cached.token) {
          token = cached.token;
          isFromCache = true;
          this.logger.log('Loaded auth token from Vercel Blob cache');
        }
      } catch (err) {
        this.logger.warn(`Failed to read cached token from Blob: ${err.message}`);
      }

      if (!token) {
        this.logger.log('Token not found in cache, parsing a new one...');
        token = await this.tokenParser.parseToken();
        try {
          await this.blobService.remove(this.cacheKey).catch(() => {});
          await this.blobService.create(this.cacheKey, { token });
        } catch (err) {
          this.logger.error(`Failed to cache new token: ${err.message}`);
        }
      }

      try {
        return await this.executeParse(url, token);
      } catch (error) {
        if (isFromCache) {
          this.logger.warn(
            `Parse failed with cached token. Invalidating cache and retrying. Error: ${error.message}`
          );

          try {
            await this.blobService.remove(this.cacheKey);
          } catch (err) {
            this.logger.error(`Failed to remove invalid token from Blob: ${err.message}`);
          }

          this.logger.log('Parsing new token after cached token failed...');
          const newToken = await this.tokenParser.parseToken();

          try {
            await this.blobService.create(this.cacheKey, { token: newToken });
          } catch (err) {
            this.logger.error(`Failed to cache new token on retry: ${err.message}`);
          }

          this.logger.log('Retrying parse request with newly fetched token...');
          return await this.executeParse(url, newToken);
        }

        throw error;
      }
    } catch (error) {
      this.logger.error(`Vidssave download error: ${error.message}`, error.stack);
      throw error;
    }
  }

  private async executeParse(url: string, auth: string): Promise<DownloadResult> {
    const memeType = getMemeTypeFromUrl(url);
    const body = new URLSearchParams({
      auth,
      domain: 'api-ak.vidssave.com',
      origin: 'source',
      link: url,
    });

    const parseRes = await fetch('https://api.vidssave.com/api/contentsite_api/media/parse', {
      method: 'POST',
      headers: {
        accept: '*/*',
        'accept-language': 'uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7',
        'cache-control': 'no-cache',
        'content-type': 'application/x-www-form-urlencoded',
        pragma: 'no-cache',
        referer: 'https://vidssave.com/',
      },
      body: body.toString(),
    });

    if (!parseRes.ok) {
      throw new Error(`Vidssave parse failed with status: ${parseRes.status}`);
    }

    const responseData = (await parseRes.json()) as VidssaveParseResponse;
    if (!responseData || responseData.status !== 1 || !responseData.data) {
      throw new Error(responseData?.message || 'Vidssave parse response status is unsuccessful');
    }

    const result = VidssaveAdapter.toDownloadResult(responseData.data, memeType.toLowerCase());

    // Sort media list by quality descending (best quality first)
    sortMediaByQuality(result.media);

    if (result.media.length === 0) {
      throw new Error('Vidssave returned no formats/resources or invalid response structure');
    }

    return result;
  }
}
