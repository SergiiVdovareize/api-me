import { Injectable, StreamableFile, HttpException, HttpStatus } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import phantomJsCloud from 'phantomjscloud';
import { env } from 'process';
import { Readable } from 'stream';
import { AsyncService } from 'src/async/async.service';
import { getPublerScript } from 'src/common/phantomScripts/publer';
import { getIndeviceScript } from 'src/common/phantomScripts/getindevice';
import { getSquidlrScript } from 'src/common/phantomScripts/squidlr';
import { getSnapScript } from 'src/common/phantomScripts/snap';
import { RequestsService } from 'src/requests/requests.service';
import { writeFile } from 'fs';
import { ParseResult } from 'src/common/types/ParseResult';
import { downloadMedia, DownloadResult } from 'mediasnap';
import { snapsave } from 'snapsave-adapter';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { AnalyticsEvent } from 'src/analytics/analytics.events';
import { MemeType } from './meme-type.enum';

const PUBLER_URL = 'https://publer.io/tools/media-downloader';
const GETINDEVICE_URL = 'https://getindevice.com';
const SQUIDLR_URL = 'https://www.squidlr.com';
const SNAP_URL = 'https://snap-insta.app';
const MAX_ATTEMPTS = 3;

@Injectable()
export class MemesService {
  constructor(
    private readonly asyncService: AsyncService,
    private readonly requestsService: RequestsService,
    private readonly analyticsService: AnalyticsService
  ) {}

  private getMemeTypeFromUrl(url: string): MemeType {
    if (url.includes('youtube.com') || url.includes('youtu.be')) return MemeType.YOUTUBE;
    if (url.includes('instagram.com')) return MemeType.INSTAGRAM;
    if (url.includes('x.com') || url.includes('twitter.com')) return MemeType.TWITTER;
    if (url.includes('facebook.com') || url.includes('fb.watch')) return MemeType.FACEBOOK;
    if (url.includes('tiktok.com')) return MemeType.TIKTOK;
    if (url.includes('linkedin.com')) return MemeType.LINKEDIN;
    if (url.includes('threads.com')) return MemeType.THREADS;
    return MemeType.UNKNOWN;
  }

  private trackStealing(url: string, startTime: number, tool: string, result: ParseResult) {
    const data = {
      executionTime: Date.now() - Number(startTime),
      success: !!result?.success,
      tool,
    };
    this.requestsService.registerMemeApiCall(url, data);
  }

  private async execute(tool: string, toolUrl: string, memeUrl: string, script: () => void) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const phantomJsCloud = require('phantomjscloud');
    // const phantomJsCloud =
    const apiKey = env.PHANTOMJS_CLOUD_API_KEY;
    const browser = new phantomJsCloud.BrowserApi(apiKey);

    const photo = false;
    const logFile = false;

    const req = {
      url: toolUrl,
      renderType: 'automation',
      overseerScript: script(),
    };

    if (photo) {
      return this.makePhoto(browser, req);
    }

    const startTime = Date.now();
    const pageRequest: phantomJsCloud.ioDatatypes.IPageRequest = req;
    const userResponse = await browser.requestSingle(pageRequest);
    let result: ParseResult;

    if (userResponse.statusCode === 200) {
      try {
        if (logFile) {
          writeFile(
            'response.json',
            userResponse.content.data.renders[0].data,
            {
              encoding: userResponse.content.encoding,
            },
            err => {
              if (err) {
                console.log('error', err);
              }
              console.log('captured page written');
            }
          );
        }

        result = JSON.parse(userResponse.content.data.renders[0].data);
      } catch (error) {
        // console.log('** errors', userResponse.content.data.errors)
        // console.log('stealing error');
        // console.error(error);
        result = {
          success: false,
          error: 'could not steal the meme: ' + error,
        };
      }
    } else {
      result = {
        success: false,
        error: 'could not steal the meme v2',
      };
    }

    this.trackStealing(memeUrl, startTime, tool, result);
    return result;
  }

  private async makePhoto(browser, req) {
    req.renderType = 'jpeg';
    const pageRequest: phantomJsCloud.ioDatatypes.IPageRequest = req;
    const userResponse = await browser.requestSingle(pageRequest);

    const fileName = userResponse.content.name;
    writeFile(
      fileName,
      userResponse.content.data,
      {
        encoding: userResponse.content.encoding,
      },
      err => {
        console.log('error', err);
        console.log('captured page written to ' + fileName);
      }
    );

    return {};
  }

  async steelFromPubler(url: string): Promise<any> {
    const script = getPublerScript.bind(this, url);
    // console.log('script', script());
    return await this.asyncService.prepareResult(
      this.execute.bind(this, 'publer', PUBLER_URL, url, script)
    );
  }

  async steelFromGetInDevice(url: string): Promise<any> {
    const toolUrl = `${GETINDEVICE_URL}/#url=${encodeURIComponent(url)}`;
    return await this.asyncService.prepareResult(
      this.execute.bind(this, 'getindevice', toolUrl, url, getIndeviceScript)
    );
  }

  async steelFromSquidlr(url: string): Promise<any> {
    const toolUrl = `${SQUIDLR_URL}/download?url=${encodeURIComponent(url)}`;
    return await this.asyncService.prepareResult(
      this.execute.bind(this, 'squidlr', toolUrl, url, getSquidlrScript)
    );
  }

  async steelFromSnap(url: string): Promise<any> {
    const script = getSnapScript.bind(this, url);
    return await this.asyncService.prepareResult(
      this.execute.bind(this, 'snap', SNAP_URL, url, script)
    );
  }

  async stealWithSnapsave(url: string): Promise<DownloadResult> {
    const memeType = this.getMemeTypeFromUrl(url);
    this.analyticsService.trackEvent(AnalyticsEvent.StealMeme, { memeUrl: url, memeType });
    try {
      const result = await snapsave(url);
      return result;
    } catch (error) {
      console.error('Snapsave download error:', error);
      throw error;
    }
  }

  async stealWithMediasnap(url: string): Promise<DownloadResult> {
    const memeType = this.getMemeTypeFromUrl(url);
    this.analyticsService.trackEvent(AnalyticsEvent.StealMeme, { memeUrl: url, memeType });
    try {
      const result = await downloadMedia(url);
      return result;
    } catch (error) {
      console.error('Download error:', error);
      throw error;
    }
  }

  async stealWithNextdownloader(url: string): Promise<DownloadResult> {
    // console.log('stealWithNextdownloader', url);
    const memeType = this.getMemeTypeFromUrl(url);
    // console.log('memeType', memeType);

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
      // console.log('response', response);

      if (!response.ok) {
        throw new Error(`NextDownloader analyze failed with status: ${response.status}`);
      }

      const data = (await response.json()) as any;
      // console.log('data', data);

      if (!data || !data.formats || data.formats.length === 0) {
        throw new Error('NextDownloader returned no formats or invalid response');
      }

      const host = env.API_URL || 'http://localhost:3000';
      const title = data.title || 'video';
      const duration = data.duration || '';

      const media = data.formats.map((format: any) => {
        const isAudio = ['mp3', 'm4a', 'aac', 'flac', 'opus', 'wav'].includes(
          format.ext?.toLowerCase()
        );
        const type = isAudio ? 'audio' : 'video';
        const quality = format.quality || null;
        const formatExt = format.ext || 'mp4';

        const proxyUrl = `${host}/memes/download/next?url=${encodeURIComponent(url)}&type=${type}&quality=${encodeURIComponent(quality || '')}&ext=${formatExt}&title=${encodeURIComponent(title)}&duration=${encodeURIComponent(duration)}`;

        return {
          type,
          url: proxyUrl,
          quality,
          format: formatExt,
          sizeMB: null,
        };
      });

      return {
        success: true,
        platform: memeType.toLowerCase(),
        title: data.title || null,
        description: data.description || null,
        thumbnail: data.thumbnail || null,
        duration: data.duration || null,
        media,
      };
    } catch (error) {
      console.error('NextDownloader download error:', error);
      throw error;
    }
  }

  async stealWithHighreach(url: string): Promise<DownloadResult> {
    const memeType = this.getMemeTypeFromUrl(url);
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

      const data = (await response.json()) as any;

      if (!data) {
        throw new Error('Highreach returned invalid or empty response');
      }

      const directUrl =
        data.url ||
        data.download_url ||
        data.downloadUrl ||
        data.video_url ||
        data.gif ||
        data.video;
      let media: any[] = [];

      if (directUrl && typeof directUrl === 'string') {
        media.push({
          type: 'video',
          url: directUrl,
          quality: null,
          format: 'mp4',
          sizeMB: null,
        });
      } else if (Array.isArray(data.formats)) {
        media = data.formats.map((format: any) => ({
          type: format.type || 'video',
          url: format.url || format.download_url,
          quality: format.quality || null,
          format: format.ext || format.format || 'mp4',
          sizeMB: null,
        }));
      } else if (Array.isArray(data.media)) {
        media = data.media.map((item: any) => ({
          type: item.type || 'video',
          url: item.url,
          quality: item.quality || null,
          format: item.format || 'mp4',
          sizeMB: null,
        }));
      }

      if (media.length === 0) {
        throw new Error('Highreach returned no formats or invalid response');
      }

      return {
        success: true,
        platform: memeType.toLowerCase(),
        title: data.title || null,
        description: data.description || null,
        thumbnail: data.thumbnail || null,
        duration: data.duration || null,
        media,
      };
    } catch (error) {
      console.error('Highreach download error:', error);
      throw error;
    }
  }

  async downloadFromNextdownloader(params: {
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

  async stealWithVidssave(url: string): Promise<DownloadResult> {
    const memeType = this.getMemeTypeFromUrl(url);
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

      const responseData = (await parseRes.json()) as any;
      if (!responseData || responseData.status !== 1 || !responseData.data) {
        throw new Error(responseData?.message || 'Vidssave parse response status is unsuccessful');
      }

      const data = responseData.data;

      // 6. Convert response to the DownloadResult format
      const mediaList: any[] = [];
      if (Array.isArray(data.media)) {
        for (const item of data.media) {
          if (item && Array.isArray(item.resources)) {
            for (const res of item.resources) {
              if (res && res.download_url) {
                const isAudio =
                  res.type === 'audio' ||
                  ['mp3', 'm4a', 'aac', 'flac', 'opus', 'wav'].includes(res.format?.toLowerCase());
                mediaList.push({
                  type: isAudio ? 'audio' : 'video',
                  url: res.download_url,
                  quality: res.quality || null,
                  format: res.format?.toLowerCase() || null,
                  sizeMB: res.size ? Number((res.size / (1024 * 1024)).toFixed(2)) : null,
                });
              }
            }
          }
        }
      }

      // Fallback: if data.media did not yield resources but data.resources has items
      if (mediaList.length === 0 && Array.isArray(data.resources)) {
        for (const res of data.resources) {
          if (res && res.download_url) {
            const isAudio =
              res.type === 'audio' ||
              ['mp3', 'm4a', 'aac', 'flac', 'opus', 'wav'].includes(res.format?.toLowerCase());
            mediaList.push({
              type: isAudio ? 'audio' : 'video',
              url: res.download_url,
              quality: res.quality || null,
              format: res.format?.toLowerCase() || null,
              sizeMB: res.size ? Number((res.size / (1024 * 1024)).toFixed(2)) : null,
            });
          }
        }
      }

      // Sort media list by quality descending (best quality first)
      this.sortMediaByQuality(mediaList);

      if (mediaList.length === 0) {
        throw new Error('Vidssave returned no formats/resources or invalid response structure');
      }

      return {
        success: true,
        platform: memeType.toLowerCase(),
        title: data.title || null,
        description: data.description || null,
        thumbnail: data.thumbnail || null,
        duration: data.duration || null,
        media: mediaList,
      };
    } catch (error) {
      console.error('Vidssave download error:', error);
      throw error;
    }
  }

  private sortMediaByQuality<T extends { quality?: string | null }>(media: T[]): T[] {
    return media.sort((a, b) => {
      const getQualityNum = (q: string | null | undefined): number => {
        if (!q) return 0;
        const cleanQ = q.replace(/mp4|mp3|m4a|3gp/gi, '');
        const match = cleanQ.match(/\d+/);
        return match ? parseInt(match[0], 10) : 0;
      };
      return getQualityNum(b.quality) - getQualityNum(a.quality);
    });
  }

  async stealMeme(url: string): Promise<DownloadResult> {
    const downloaders = [
      { name: 'mediasnap', fn: () => this.stealWithMediasnap(url) },
      { name: 'snapsave', fn: () => this.stealWithSnapsave(url) },
      // { name: 'nextdownloader', fn: () => this.stealWithNextdownloader(url) },
      { name: 'highreach', fn: () => this.stealWithHighreach(url) },
      { name: 'vidssave', fn: () => this.stealWithVidssave(url) },
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
