import { Injectable, StreamableFile } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { RequestsService } from 'src/requests/requests.service';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { DownloadResult } from 'mediasnap';
import {
  SnapsaveDownloader,
  MediasnapDownloader,
  NextDownloader,
  HighreachDownloader,
  VidssaveDownloader,
} from './downloaders';
import { sortMediaByQuality } from './utils/quality-sort';

const MAX_ATTEMPTS = 3;

@Injectable()
export class MemesService {
  constructor(
    private readonly requestsService: RequestsService,
    private readonly analyticsService: AnalyticsService,
    private readonly snapsaveDownloader: SnapsaveDownloader,
    private readonly mediasnapDownloader: MediasnapDownloader,
    private readonly nextDownloader: NextDownloader,
    private readonly highreachDownloader: HighreachDownloader,
    private readonly vidssaveDownloader: VidssaveDownloader
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
    const downloaders = [
      { name: 'mediasnap', fn: () => this.mediasnapDownloader.steal(url) },
      { name: 'snapsave', fn: () => this.snapsaveDownloader.steal(url) },
      // { name: 'nextdownloader', fn: () => this.nextDownloader.steal(url) },
      { name: 'highreach', fn: () => this.highreachDownloader.steal(url) },
      { name: 'vidssave', fn: () => this.vidssaveDownloader.steal(url) },
    ];

    const errors: { attempt: number; downloader: string; error: any }[] = [];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const run = async (downloader: (typeof downloaders)[0]) => {
          try {
            const res = await downloader.fn();
            if (res && res.success) {
              return res;
            }
            throw new Error(res?.error || `returned unsuccessful result`);
          } catch (err) {
            errors.push({ attempt, downloader: downloader.name, error: err });
            throw err;
          }
        };

        const successfulResult = await Promise.any(downloaders.map(run));
        if (successfulResult && Array.isArray(successfulResult.media)) {
          successfulResult.media = successfulResult.media.filter(item => {
            if (!item || typeof item.url !== 'string') {
              return false;
            }
            const urlStr = item.url.trim();
            return (
              urlStr.startsWith('http://') ||
              urlStr.startsWith('https://') ||
              urlStr.startsWith('//')
            );
          });

          // Sort media list by quality descending (best quality first)
          sortMediaByQuality(successfulResult.media);
        }

        if (
          successfulResult &&
          successfulResult.success &&
          successfulResult.media &&
          successfulResult.media.length > 0
        ) {
          return successfulResult;
        }

        throw new Error('Success is false or media is empty');
      } catch (err) {
        if (err.message === 'Success is false or media is empty') {
          errors.push({ attempt, downloader: 'all', error: err });
        }
      }
    }

    Sentry.captureMessage(`stealMeme failed, url - ${url}`, {
      level: 'error',
      extra: {
        url,
        attempts: MAX_ATTEMPTS,
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
}
