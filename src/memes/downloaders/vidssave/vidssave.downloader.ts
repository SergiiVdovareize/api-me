import { Injectable } from '@nestjs/common';
import { DownloadResult } from 'mediasnap';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { AnalyticsEvent } from 'src/analytics/analytics.events';
import { getMemeTypeFromUrl } from '../../meme-type.enum';
import { MemeDownloader } from '../downloader.interface';
import { sortMediaByQuality } from '../../utils/quality-sort';
import { VidssaveAdapter, VidssaveParseResponse } from './vidssave.adapter';

@Injectable()
export class VidssaveDownloader implements MemeDownloader {
  readonly name = 'vidssave';

  constructor(private readonly analyticsService: AnalyticsService) {}

  async steal(url: string): Promise<DownloadResult> {
    const memeType = getMemeTypeFromUrl(url);
    this.analyticsService.trackEvent(AnalyticsEvent.StealMeme, { memeUrl: url, memeType });

    try {
      // 1. Get HTML content of the landing page
      const landingRes = await fetch('https://vidssave.com/youtube-video-downloader-6fu');
      if (!landingRes.ok) {
        throw new Error(`Failed to fetch vidssave landing page: ${landingRes.statusText}`);
      }
      const landingHtml = await landingRes.text();

      // 2. Find script tag with layout path (site)/layout-[id].js
      const scriptRegex = /src="([^"]*\(site\)\/layout-[a-zA-Z0-9_-]+\.js)"/;
      const scriptMatch = landingHtml.match(scriptRegex);
      if (!scriptMatch || !scriptMatch[1]) {
        throw new Error('Could not find the vidssave layout script URL in landing page HTML');
      }

      let scriptUrl = scriptMatch[1];
      if (!scriptUrl.startsWith('http')) {
        scriptUrl = `https://vidssave.com${scriptUrl.startsWith('/') ? '' : '/'}${scriptUrl}`;
      }

      // 3. Get the JS file content
      const jsRes = await fetch(scriptUrl);
      if (!jsRes.ok) {
        throw new Error(`Failed to fetch vidssave layout script: ${jsRes.statusText}`);
      }
      const jsContent = await jsRes.text();

      // 4. Find part starting with auth=
      const authRegex = /auth=([a-zA-Z0-9_-]+)/;
      const authMatch = jsContent.match(authRegex);
      if (!authMatch || !authMatch[1]) {
        throw new Error('Could not find auth token in vidssave layout script');
      }
      const auth = authMatch[1];

      // 5. Using found token do POST request to parse endpoint
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
    } catch (error) {
      console.error('Vidssave download error:', error);
      throw error;
    }
  }
}
