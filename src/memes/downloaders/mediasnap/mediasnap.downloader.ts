import { Injectable } from '@nestjs/common';
import { downloadMedia, DownloadResult } from 'mediasnap';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { AnalyticsEvent } from 'src/analytics/analytics.events';
import { getMemeTypeFromUrl } from '../../meme-type.enum';
import { MemeDownloader } from '../downloader.interface';
import { MediasnapAdapter } from './mediasnap.adapter';

@Injectable()
export class MediasnapDownloader implements MemeDownloader {
  readonly name = 'mediasnap';

  constructor(private readonly analyticsService: AnalyticsService) {}

  async steal(url: string): Promise<DownloadResult> {
    const memeType = getMemeTypeFromUrl(url);
    this.analyticsService.trackEvent(AnalyticsEvent.StealMeme, { memeUrl: url, memeType });
    try {
      const rawResult = await downloadMedia(url);
      return MediasnapAdapter.toDownloadResult(rawResult);
    } catch (error) {
      console.error('Download error:', error);
      throw error;
    }
  }
}
