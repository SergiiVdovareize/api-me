import { Injectable } from '@nestjs/common';
import { snapsave } from 'snapsave-adapter';
import { DownloadResult } from 'mediasnap';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { AnalyticsEvent } from 'src/analytics/analytics.events';
import { getMemeTypeFromUrl } from '../../meme-type.enum';
import { MemeDownloader } from '../downloader.interface';
import { SnapsaveAdapter } from './snapsave.adapter';

@Injectable()
export class SnapsaveDownloader implements MemeDownloader {
  readonly name = 'snapsave';

  constructor(private readonly analyticsService: AnalyticsService) {}

  async steal(url: string): Promise<DownloadResult> {
    const memeType = getMemeTypeFromUrl(url);
    this.analyticsService.trackEvent(AnalyticsEvent.StealMeme, { memeUrl: url, memeType });
    try {
      const rawResult = await snapsave(url);
      return SnapsaveAdapter.toDownloadResult(rawResult);
    } catch (error) {
      console.error('Snapsave download error:', error);
      throw error;
    }
  }
}
