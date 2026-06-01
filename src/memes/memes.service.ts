import { Injectable } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import phantomJsCloud from 'phantomjscloud';
import { env } from 'process';
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

  async stealMeme(url: string): Promise<DownloadResult> {
    const downloaders = [
      { name: 'mediasnap', fn: () => this.stealWithMediasnap(url) },
      { name: 'snapsave', fn: () => this.stealWithSnapsave(url) },
    ];

    const errors: { downloader: string; error: any }[] = [];

    const run = async (downloader: (typeof downloaders)[0]) => {
      try {
        const res = await downloader.fn();
        if (res && res.success) {
          return res;
        }
        throw new Error(res?.error || `returned unsuccessful result`);
      } catch (err) {
        errors.push({ downloader: downloader.name, error: err });
        throw err;
      }
    };

    try {
      const successfulResult = await Promise.any(downloaders.map(run));
      return successfulResult;
    } catch {
      Sentry.captureMessage(`stealMeme failed, url - ${url}`, {
        level: 'error',
        extra: {
          url,
          errors: errors.map(e => ({
            downloader: e.downloader,
            message: e.error?.message || String(e.error),
            stack: e.error?.stack,
          })),
        },
      });

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
}
