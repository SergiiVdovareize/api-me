import { Injectable } from '@nestjs/common';
import phantomJsCloud from 'phantomjscloud';
import { env } from 'process';
import { AsyncService } from 'src/async/async.service';
import { getPublerScript } from 'src/common/phantomScripts/publer';
import { getIndeviceScript } from 'src/common/phantomScripts/getindevice';
import { getSquidlrScript } from 'src/common/phantomScripts/squidlr';
import { getSnapScript } from 'src/common/phantomScripts/snap';
import { RequestsService } from 'src/requests/requests.service';
import { writeFile } from 'fs';

const PUBLER_URL = 'https://publer.io/tools/media-downloader';
const GETINDEVICE_URL = 'https://getindevice.com';
const SQUIDLR_URL = 'https://www.squidlr.com';
const SNAP_URL = 'https://snap-insta.app';

@Injectable()
export class MemesService {
  constructor(
    private readonly asyncService: AsyncService,
    private readonly requestsService: RequestsService,
  ) {}

  private trackStealing(
    url: string,
    startTime: Number,
    tool: string,
    result: { success: boolean; data: string },
  ) {
    const data = {
      executionTime: Date.now() - Number(startTime),
      success: !!result.success,
      tool,
    };
    this.requestsService.registerMemeApiCall(url, data);
  }

  private async execute(
    tool: string,
    toolUrl: string,
    memeUrl: string,
    script: Function,
  ) {
    const phantomJsCloud = require('phantomjscloud');
    let apiKey = env.PHANTOMJS_CLOUD_API_KEY;
    let browser = new phantomJsCloud.BrowserApi(apiKey);

    const photo = false;
    const req = {
      url: toolUrl,
      renderType: 'automation',
      overseerScript: script(),
    };

    if (photo) {
      req.renderType = 'jpeg';
    }

    const startTime = Date.now();
    let pageRequest: phantomJsCloud.ioDatatypes.IPageRequest = req;
    const userResponse = await browser.requestSingle(pageRequest);

    if (photo) {
      const fileName = userResponse.content.name;
      writeFile(
        fileName,
        userResponse.content.data,
        {
          encoding: userResponse.content.encoding,
        },
        (err) => {
          console.log('captured page written to ' + fileName);
        },
      );

      return {};
    }

    let result: { success: boolean; data: string };

    if (userResponse.statusCode === 200) {
      try {
        const resultUrl = JSON.parse(
          userResponse.content.data.renders[0].data,
        ).url;
        console.log('result url', resultUrl);
        result = {
          success: true,
          data: resultUrl,
        };
      } catch (error) {
        console.log('stealing error');
        console.error(error);
        console.log(userResponse);
        result = {
          success: false,
          data: 'could not steal the meme v1',
        };
      }
    } else {
      console.log('could not get result');
      // console.log(userResponse);
      result = {
        success: false,
        data: 'could not steal the meme v2',
      };
    }

    this.trackStealing(memeUrl, startTime, tool, result);
    return result;
  }

  async steelFromPubler(url: string): Promise<any> {
    const script = getPublerScript.bind(this, url);
    return await this.asyncService.prepareResult(
      this.execute.bind(this, 'publer', PUBLER_URL, url, script),
    );
  }

  async steelFromGetInDevice(url: string): Promise<any> {
    const toolUrl = `${GETINDEVICE_URL}/#url=${encodeURIComponent(url)}`;
    return await this.asyncService.prepareResult(
      this.execute.bind(this, 'getindevice', toolUrl, url, getIndeviceScript),
    );
  }

  async steelFromSquidlr(url: string): Promise<any> {
    const toolUrl = `${SQUIDLR_URL}/download?url=${encodeURIComponent(url)}`;
    return await this.asyncService.prepareResult(
      this.execute.bind(this, 'squidlr', toolUrl, url, getSquidlrScript),
    );
  }

  async steelFromSnap(url: string): Promise<any> {
    const script = getSnapScript.bind(this, url);
    return await this.asyncService.prepareResult(
      this.execute.bind(this, 'snap', SNAP_URL, url, script),
    );
  }
}
