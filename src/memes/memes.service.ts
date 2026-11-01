import { HttpException, HttpStatus, Injectable, StreamableFile } from '@nestjs/common';
import { Readable } from 'stream';
import * as Sentry from '@sentry/nestjs';
import { DownloadResult } from 'mediasnap';
import {
  SnapsaveDownloader,
  MediasnapDownloader,
  NextDownloader,
  HighreachDownloader,
  VidssaveDownloader,
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

    for (let attempt = 1; attempt <= MEMES_CONSTANTS.MAX_ATTEMPTS; attempt++) {
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

    const isSyntheticTest = (() => {
      try {
        const hostname = new URL(url).hostname.toLowerCase();
        return (
          hostname === 'example.com' ||
          hostname.endsWith('.example.com') ||
          hostname === 'localhost' ||
          hostname === '127.0.0.1' ||
          url.includes('invalid-meme-url')
        );
      } catch {
        return url.includes('example.com') || url.includes('invalid-meme-url');
      }
    })();

    if (!isSyntheticTest) {
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

  isDirectVideoUrl(url: string): boolean {
    try {
      const pathname = new URL(url).pathname.toLowerCase();
      return /\.(mp4|webm|ogg|mov)$/i.test(pathname);
    } catch {
      return false;
    }
  }

  async streamVideo(url: string, filename?: string): Promise<StreamableFile> {
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
