import { Injectable } from '@nestjs/common';
import { DownloadResult } from 'mediasnap';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { AnalyticsEvent } from 'src/analytics/analytics.events';
import { getMemeTypeFromUrl } from '../../meme-type.enum';
import { MemeDownloader } from '../downloader.interface';
import { HighreachAdapter, HighreachResponse } from './highreach.adapter';

@Injectable()
export class HighreachDownloader implements MemeDownloader {
  readonly name = 'highreach';

  constructor(private readonly analyticsService: AnalyticsService) {}

  async steal(url: string): Promise<DownloadResult> {
    const memeType = getMemeTypeFromUrl(url);
    this.analyticsService.trackEvent(AnalyticsEvent.StealMeme, { memeUrl: url, memeType });

    try {
      const response = await fetch('https://highreach.ai/api/tools/twitter-gif-download', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: '*/*',
        },
        body: JSON.stringify({ tweet_url: url }),
      });

      if (!response.ok) {
        throw new Error(`Highreach analyze failed with status: ${response.status}`);
      }

      const data = (await response.json()) as HighreachResponse;

      if (!data) {
        throw new Error('Highreach returned invalid or empty response');
      }

      const result = HighreachAdapter.toDownloadResult(data, memeType.toLowerCase());

      if (result.media.length === 0) {
        throw new Error('Highreach returned no formats or invalid response');
      }

      return result;
    } catch (error) {
      console.error('Highreach download error:', error);
      throw error;
    }
  }
}
