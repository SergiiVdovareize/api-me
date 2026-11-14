import { HttpException, HttpStatus, Injectable, Optional, StreamableFile } from '@nestjs/common';
import { Readable } from 'stream';
import * as Sentry from '@sentry/nestjs';
import { DownloadResult } from 'mediasnap';
import { AnalyticsEvent } from 'src/analytics/analytics.events';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { getMemeTypeFromUrl } from './meme-type.enum';
import {
  SnapsaveDownloader,
  MediasnapDownloader,
  NextDownloader,
  HighreachDownloader,
  VidssaveDownloader,
  SaveanyvideoDownloader,
} from './downloaders';
import { sortMediaByQuality } from './utils/quality-sort';
import { MEMES_CONSTANTS } from './memes.constants';

@Injectable()
export class MemesService {
  constructor(
    private readonly snapsaveDownloader: SnapsaveDownloader,
    private readonly mediasnapDownloader: MediasnapDownloader,
    private readonly nextDownloader: NextDownloader,
    private readonly highreachDownloader: HighreachDownloader,
    private readonly vidssaveDownloader: VidssaveDownloader,
    private readonly saveanyvideoDownloader: SaveanyvideoDownloader,
    @Optional() private readonly analyticsService?: AnalyticsService
  ) {}

  async downloadFromNextdownloader(params: {
    url: string;
    type: string;
    quality: string;
    ext: string;
    title: string;
    duration: string;
  }): Promise<StreamableFile> {
    return this.nextDownloader.download(params);
  }

  async stealMeme(url: string): Promise<DownloadResult> {
    const startedAt = Date.now();
    const isSyntheticTest = this.isSyntheticTest(url);
    const downloaders = [
      { name: 'mediasnap', fn: () => this.mediasnapDownloader.steal(url) },
      { name: 'snapsave', fn: () => this.snapsaveDownloader.steal(url) },
    ];

    const errors: { attempt: number; downloader: string; error: any }[] = [];

    for (let attempt = 1; attempt <= MEMES_CONSTANTS.MAX_ATTEMPTS; attempt++) {
      try {
        const run = async (downloader: (typeof downloaders)[0]) => {
          try {
            const res = await downloader.fn();
            if (res && res.success) {
              return { downloader: downloader.name, result: res };
            }
            throw new Error(res?.error || `returned unsuccessful result`);
          } catch (err) {
            errors.push({ attempt, downloader: downloader.name, error: err });
            throw err;
          }
        };

        const winner = await Promise.any(downloaders.map(run));
        const sanitized = this.sanitizeAndSortResult(winner.result);
        if (sanitized) {
          if (!isSyntheticTest) {
            this.trackStealResult({
              url,
              success: true,
              downloader: winner.downloader,
              isFallback: false,
              attempt,
              startedAt,
              errors,
            });
          }
          return sanitized;
        }

        throw new Error('Success is false or media is empty');
      } catch (err) {
        if (err.message === 'Success is false or media is empty') {
          errors.push({ attempt, downloader: 'all', error: err });
        }
      }
    }

    // Last-resort fallback: run SaveAnyVideo only once after primary downloaders fail
    try {
      const fallbackResult = await this.saveanyvideoDownloader.steal(url);
      const sanitizedFallback = this.sanitizeAndSortResult(fallbackResult);
      if (sanitizedFallback) {
        if (!isSyntheticTest) {
          this.trackStealResult({
            url,
            success: true,
            downloader: 'saveanyvideo',
            isFallback: true,
            attempt: MEMES_CONSTANTS.MAX_ATTEMPTS + 1,
            startedAt,
            errors,
          });
        }
        return sanitizedFallback;
      }
      errors.push({
        attempt: MEMES_CONSTANTS.MAX_ATTEMPTS + 1,
        downloader: 'saveanyvideo',
        error: new Error('Success is false or media is empty'),
      });
    } catch (fallbackErr) {
      errors.push({
        attempt: MEMES_CONSTANTS.MAX_ATTEMPTS + 1,
        downloader: 'saveanyvideo',
        error: fallbackErr,
      });
    }

    if (!isSyntheticTest) {
      this.trackStealResult({
        url,
        success: false,
        downloader: null,
        isFallback: true,
        attempt: MEMES_CONSTANTS.MAX_ATTEMPTS + 1,
        startedAt,
        errors,
      });
      Sentry.captureMessage(`stealMeme failed, url - ${url}`, {
        level: 'error',
        extra: {
          url,
          attempts: MEMES_CONSTANTS.MAX_ATTEMPTS,
          errors: errors.map(e => ({
            attempt: e.attempt,
            downloader: e.downloader,
            message: e.error?.message || String(e.error),
            stack: e.error?.stack,
          })),
        },
      });

      try {
        await Sentry.flush(1000);
      } catch (flushError) {
        console.error('Sentry flush failed:', flushError);
      }
    }

    return {
      success: false,
      platform: 'unknown',
      title: null,
      description: null,
      thumbnail: null,
      duration: null,
      media: [],
      error: 'could not download the media',
    };
  }

  private trackStealResult(params: {
    url: string;
    success: boolean;
    downloader: string | null;
    isFallback: boolean;
    attempt: number;
    startedAt: number;
    errors: { attempt: number; downloader: string; error: any }[];
  }): void {
    this.analyticsService?.trackEvent(AnalyticsEvent.StealMemeResult, {
      success: params.success,
      downloader: params.downloader,
      isFallback: params.isFallback,
      attempt: params.attempt,
      durationMs: Date.now() - params.startedAt,
      memeType: getMemeTypeFromUrl(params.url),
      failedDownloaders: [
        ...new Set(params.errors.map(e => e.downloader).filter(d => d !== 'all')),
      ],
    });
  }

  private sanitizeAndSortResult(result: DownloadResult | null | undefined): DownloadResult | null {
    if (!result || !result.success || !Array.isArray(result.media)) {
      return null;
    }

    result.media = result.media.filter(item => {
      if (!item || typeof item.url !== 'string') {
        return false;
      }
      const urlStr = item.url.trim();
      return (
        urlStr.startsWith('http://') || urlStr.startsWith('https://') || urlStr.startsWith('//')
      );
    });

    sortMediaByQuality(result.media);

    return result.media.length > 0 ? result : null;
  }

  isValidHttpUrl(url: string): boolean {
    if (!url || typeof url !== 'string') {
      return false;
    }
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  isSyntheticTest(url: string): boolean {
    if (!this.isValidHttpUrl(url)) {
      return true;
    }
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.toLowerCase();
      return (
        hostname === 'example.com' ||
        hostname.endsWith('.example.com') ||
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        url.includes('invalid-meme-url')
      );
    } catch {
      return true;
    }
  }

  isDirectVideoUrl(url: string): boolean {
    if (!this.isValidHttpUrl(url)) {
      return false;
    }
    try {
      const pathname = new URL(url).pathname.toLowerCase();
      return /\.(mp4|webm|ogg|mov)$/i.test(pathname);
    } catch {
      return false;
    }
  }

  async streamVideo(url: string, filename?: string): Promise<StreamableFile> {
    if (!this.isValidHttpUrl(url)) {
      throw new HttpException(
        'Invalid URL. Please provide a valid HTTP or HTTPS video URL.',
        HttpStatus.BAD_REQUEST
      );
    }

    let directUrl = url;
    let title: string | undefined = undefined;

    if (!this.isDirectVideoUrl(url)) {
      const stealResult = await this.stealMeme(url);
      if (!stealResult.success || !stealResult.media || stealResult.media.length === 0) {
        throw new HttpException(
          stealResult.error || 'Failed to extract video from the provided URL',
          HttpStatus.NOT_FOUND
        );
      }

      // Filter for video media items only (reject photos/images)
      const videoItems = stealResult.media.filter(item => {
        if (!item || !item.url) return false;
        const type = item.type?.toLowerCase();
        if (type === 'image' || type === 'photo') return false;
        if (/\.(jpg|jpeg|png|webp|gif)($|\?)/i.test(item.url)) return false;
        return true;
      });

      if (videoItems.length === 0) {
        throw new HttpException(
          'Only video content is supported. No video stream found for this URL.',
          HttpStatus.BAD_REQUEST
        );
      }

      // The first video item is already the highest quality (sorted descending by sortMediaByQuality)
      directUrl = videoItems[0].url;
      title = stealResult.title || undefined;
    }

    return this.streamFromDirectVideoUrl(directUrl, filename, title);
  }

  async streamFromDirectVideoUrl(
    directUrl: string,
    filename?: string,
    title?: string
  ): Promise<StreamableFile> {
    const response = await fetch(directUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      throw new HttpException(
        `Failed to fetch video from source: ${response.statusText}`,
        response.status
      );
    }

    const contentType = response.headers.get('content-type') || 'video/mp4';
    if (contentType.startsWith('image/')) {
      throw new HttpException(
        'Only video content is supported. Upstream returned an image.',
        HttpStatus.BAD_REQUEST
      );
    }

    if (!response.body) {
      throw new HttpException(
        'No response body received from media server',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    const nodeReadable = Readable.fromWeb(response.body as any);
    const contentLength = response.headers.get('content-length');

    let ext = 'mp4';
    const contentTypeBase = contentType.split(';')[0].trim().toLowerCase();
    if (contentTypeBase === 'video/webm') ext = 'webm';
    else if (contentTypeBase === 'video/quicktime') ext = 'mov';
    else if (contentTypeBase === 'video/ogg') ext = 'ogg';

    let finalFilename = filename;
    if (!finalFilename) {
      if (title) {
        const sanitizedTitle = title
          .replace(/[^a-zA-Z0-9_\u0400-\u04FF\s-]/g, '')
          .trim()
          .slice(0, 50)
          .replace(/\s+/g, '_');
        if (sanitizedTitle) {
          finalFilename = `${sanitizedTitle}.${ext}`;
        }
      }
      if (!finalFilename) {
        const alphanumId = Math.random().toString(36).concat('00000000').slice(2, 10);
        finalFilename = `video_${alphanumId}.${ext}`;
      }
    }

    return new StreamableFile(nodeReadable, {
      type: contentType,
      disposition: `attachment; filename="${encodeURIComponent(finalFilename)}"`,
      length: contentLength ? parseInt(contentLength, 10) : undefined,
    });
  }
}
