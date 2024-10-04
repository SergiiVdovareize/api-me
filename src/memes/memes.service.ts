import { Injectable } from '@nestjs/common';
import phantomJsCloud from 'phantomjscloud';
import { env } from 'process';
import { AsyncService } from 'src/async/async.service';
import { getScraperScript } from 'src/common/phantomScripts/publer';
import { RequestsService } from 'src/requests/requests.service';

const PUBLER_URL = 'https://publer.io/tools/media-downloader';

@Injectable()
export class MemesService {
  constructor(
    private readonly asyncService: AsyncService,
    private readonly requestsService: RequestsService
  ) {}

  private trackStealing(url: string, startTime: Number, tool: string, result: { success: boolean, data: string}) {
    const data = {
      executionTime: Date.now() - Number(startTime),
      success: !!result.success,
      tool
    }
    this.requestsService.registerMemeApiCall(url, data);
  }

  private async execute(url: string) {
    const phantomJsCloud = require('phantomjscloud');
    let apiKey = env.PHANTOMJS_CLOUD_API_KEY;
    let browser = new phantomJsCloud.BrowserApi(apiKey);

    const req = {
      url: PUBLER_URL,
      renderType: 'automation',
      // renderType:"jpeg",
      overseerScript: getScraperScript(url),
    };

    const startTime = Date.now()
    let pageRequest: phantomJsCloud.ioDatatypes.IPageRequest = req;
    const userResponse = await browser.requestSingle(pageRequest);

    let result: {success: boolean, data: string};

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
        console.log(userResponse.content.data.errors);
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

    this.trackStealing(url, startTime, 'publer', result)
    return result;
  }

  async steelFromPubler(url: string): Promise<any> {
    return await this.asyncService.prepareResult(this.execute.bind(this, url));
  }
}
