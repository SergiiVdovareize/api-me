import { Injectable } from '@nestjs/common';
import phantomJsCloud from 'phantomjscloud';
import { env } from 'process';
import { getScraperScript } from 'src/common/phantomScripts/publer';

const PUBLER_URL = 'https://publer.io/tools/media-downloader'
@Injectable()
export class MemesService {
    async steelFromPubler(url: string) {
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
                return JSON.parse(userResponse.content.data.renders[0].data)
            } catch (error) {
                console.log(error)
                return null;
            }
        } else {
            return null;
        }
    }
}
