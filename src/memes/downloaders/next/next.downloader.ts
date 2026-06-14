import { Injectable, HttpException, HttpStatus, StreamableFile } from '@nestjs/common';
import { DownloadResult } from 'mediasnap';
import { env } from 'process';
import { Readable } from 'stream';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { AnalyticsEvent } from 'src/analytics/analytics.events';
import { getMemeTypeFromUrl } from '../../meme-type.enum';
import { MemeDownloader } from '../downloader.interface';
import { NextDownloaderAdapter, NextDownloaderAnalyzeResponse } from './next.adapter';

@Injectable()
export class NextDownloader implements MemeDownloader {
  readonly name = 'nextdownloader';

  constructor(private readonly analyticsService: AnalyticsService) {}

  async steal(url: string): Promise<DownloadResult> {
    const memeType = getMemeTypeFromUrl(url);
    this.analyticsService.trackEvent(AnalyticsEvent.StealMeme, { memeUrl: url, memeType });

    const cookies = env.YOUTUBE_COOKIES || null;

    try {
      const response = await fetch('https://api.nextdownloader.com/api/try-online/analyze', {
        method: 'POST',
        headers: {
          accept: 'application/json, text/plain, */*',
          'accept-language': 'uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7',
          'content-type': 'application/json',
          'sec-ch-ua': '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"macOS"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-site',
          Referer: 'https://www.nextdownloader.com/',
        },
        body: JSON.stringify({ url, cookies }),
      });

      if (!response.ok) {
        throw new Error(`NextDownloader analyze failed with status: ${response.status}`);
      }

      const data = (await response.json()) as NextDownloaderAnalyzeResponse;

      if (!data || !data.formats || data.formats.length === 0) {
        throw new Error('NextDownloader returned no formats or invalid response');
      }

      const host = env.API_URL || 'http://localhost:3000';
      return NextDownloaderAdapter.toDownloadResult(data, url, host, memeType.toLowerCase());
    } catch (error) {
      console.error('NextDownloader download error:', error);
      throw error;
    }
  }

  async download(params: {
    url: string;
    type: string;
    quality: string;
    ext: string;
    title: string;
    duration: string;
  }): Promise<StreamableFile> {
    const { url, type, quality, ext, title, duration } = params;
    const cookies = env.YOUTUBE_COOKIES || null;

    try {
      const response = await fetch('https://api.nextdownloader.com/api/try-online/download', {
        method: 'POST',
        headers: {
          accept: 'application/json, text/plain, */*',
          'accept-language': 'uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7',
          'content-type': 'application/json',
          'sec-ch-ua': '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"macOS"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-site',
          Referer: 'https://www.nextdownloader.com/',
        },
        body: JSON.stringify({
          url,
          type,
          quality,
          ext,
          title,
          cookies,
          duration,
        }),
      });

      if (!response.ok) {
        throw new HttpException(
          `Failed to download from NextDownloader: ${response.statusText}`,
          response.status
        );
      }

      if (!response.body) {
        throw new HttpException(
          'No response body received from NextDownloader',
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }

      const nodeReadable = Readable.fromWeb(response.body as any);
      const contentLength = response.headers.get('content-length');
      const contentType = response.headers.get('content-type') || 'application/octet-stream';

      const finalFilename = `${title || 'video'}.${ext}`;

      return new StreamableFile(nodeReadable, {
        type: contentType,
        disposition: `attachment; filename="${encodeURIComponent(finalFilename)}"`,
        length: contentLength ? parseInt(contentLength, 10) : undefined,
      });
    } catch (error: any) {
      console.error('Error proxying NextDownloader download:', error.message);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to download resource via NextDownloader',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
