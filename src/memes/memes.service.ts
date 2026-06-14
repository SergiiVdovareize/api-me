import { Injectable, StreamableFile } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import phantomJsCloud from 'phantomjscloud';
import { env } from 'process';
import { writeFile } from 'fs';
import { AsyncService } from 'src/async/async.service';
import { RequestsService } from 'src/requests/requests.service';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { ParseResult } from 'src/common/types/ParseResult';
import { DownloadResult } from 'mediasnap';
import { getPublerScript } from 'src/common/phantomScripts/publer';
import { getIndeviceScript } from 'src/common/phantomScripts/getindevice';
import { getSquidlrScript } from 'src/common/phantomScripts/squidlr';
import { getSnapScript } from 'src/common/phantomScripts/snap';
import {
  SnapsaveDownloader,
  MediasnapDownloader,
  NextDownloader,
  HighreachDownloader,
  VidssaveDownloader,
} from './downloaders';
import { sortMediaByQuality } from './utils/quality-sort';

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
    private readonly analyticsService: AnalyticsService,
    private readonly snapsaveDownloader: SnapsaveDownloader,
    private readonly mediasnapDownloader: MediasnapDownloader,
    private readonly nextDownloader: NextDownloader,
    private readonly highreachDownloader: HighreachDownloader,
    private readonly vidssaveDownloader: VidssaveDownloader
  ) {}

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
