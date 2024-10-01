import { Injectable } from '@nestjs/common';
import phantomJsCloud from 'phantomjscloud';
import { env } from 'process';
import { AsyncService } from 'src/async/async.service';
import { getScraperScript } from 'src/common/phantomScripts/publer';

const PUBLER_URL = 'https://publer.io/tools/media-downloader';
@Injectable()
export class MemesService {
  constructor(private readonly asyncService: AsyncService) {}

  async steelFromPubler(url: string) {
    const execute = async () => {
      const phantomJsCloud = require('phantomjscloud');
      let apiKey = env.PHANTOMJS_CLOUD_API_KEY;
      let browser = new phantomJsCloud.BrowserApi(apiKey);

      const req = {
        url: PUBLER_URL,
        renderType: 'automation',
        overseerScript: getScraperScript(url),
      };

      let pageRequest: phantomJsCloud.ioDatatypes.IPageRequest = req;
      const userResponse = await browser.requestSingle(pageRequest);
      if (userResponse.statusCode === 200) {
        try {
          const resultUrl = JSON.parse(
            userResponse.content.data.renders[0].data,
          ).url;
          console.log('result url', resultUrl);
          return {
            success: true,
            data: resultUrl,
          };
        } catch (error) {
          console.log('stealing error');
          console.log(error);
          return {
            success: false,
            data: 'could not steal the meme v1',
          };
        }
      } else {
        console.log('could not get result');
        console.log(userResponse);
        return {
          success: false,
          data: 'could not steal the meme v2',
        };
      }
    };

    return await this.asyncService.prepareResult(execute);
  }
}
