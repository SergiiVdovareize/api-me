import { Injectable } from '@nestjs/common';
import phantomJsCloud from 'phantomjscloud';
import { env } from 'process';
import { AsyncService } from 'src/async/async.service';
import { getScraperScript } from 'src/common/phantomScripts/publer';

const PUBLER_URL = 'https://publer.io/tools/media-downloader'
@Injectable()
export class MemesService {
    constructor(
        private readonly asyncService: AsyncService,
    ) {}

    async steelFromPubler(url: string) {
        const execute = async () => {
            const phantomJsCloud = require("phantomjscloud");
            let apiKey = env.PHANTOMJS_CLOUD_API_KEY
            let browser = new phantomJsCloud.BrowserApi(apiKey);

            const req = {
                url: PUBLER_URL,
                renderType: 'automation',
                overseerScript: getScraperScript(url)
            }
            
            let pageRequest: phantomJsCloud.ioDatatypes.IPageRequest = req;
            const userResponse = await browser.requestSingle(pageRequest);
            if (userResponse.statusCode === 200) {
                try {
                    return {
                        success: true,
                        data: JSON.parse(userResponse.content.data.renders[0].data).url,
                    }
                } catch (error) {
                    return null;
                }
            } else {
                return null;
            }
        }

        return await this.asyncService.prepareResult(execute)
    }
}
