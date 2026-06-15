import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class VidssaveTokenParser {
  private readonly logger = new Logger(VidssaveTokenParser.name);

  async parseToken(): Promise<string> {
    this.logger.log('Fetching vidssave landing page to find layout script...');
    const landingRes = await fetch('https://vidssave.com/youtube-video-downloader-6fu', {
      headers: {
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    });
    if (!landingRes.ok) {
      let bodyText = '';
      try {
        bodyText = (await landingRes.text()).slice(0, 500);
      } catch (e) {
        bodyText = `Failed to get body: ${e.message}`;
      }
      const headersObj = {};
      landingRes.headers.forEach((val, key) => {
        headersObj[key] = val;
      });
      this.logger.error(
        `Failed to fetch vidssave landing page. Status: ${landingRes.status} ${landingRes.statusText}. ` +
          `Headers: ${JSON.stringify(headersObj)}. ` +
          `Body (first 500 chars): ${bodyText}`
      );
      throw new Error(
        `Failed to fetch vidssave landing page: ${landingRes.status} ${landingRes.statusText}`
      );
    }
    const landingHtml = await landingRes.text();

    const scriptRegex = /src="([^"]*\(site\)\/layout-[a-zA-Z0-9_-]+\.js)"/;
    const scriptMatch = landingHtml.match(scriptRegex);
    if (!scriptMatch || !scriptMatch[1]) {
      throw new Error('Could not find the vidssave layout script URL in landing page HTML');
    }

    let scriptUrl = scriptMatch[1];
    if (!scriptUrl.startsWith('http')) {
      scriptUrl = `https://vidssave.com${scriptUrl.startsWith('/') ? '' : '/'}${scriptUrl}`;
    }

    this.logger.log(`Fetching vidssave layout script from ${scriptUrl}...`);
    const jsRes = await fetch(scriptUrl, {
      headers: {
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://vidssave.com/',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    });
    if (!jsRes.ok) {
      let bodyText = '';
      try {
        bodyText = (await jsRes.text()).slice(0, 500);
      } catch (e) {
        bodyText = `Failed to get body: ${e.message}`;
      }
      const headersObj = {};
      jsRes.headers.forEach((val, key) => {
        headersObj[key] = val;
      });
      this.logger.error(
        `Failed to fetch vidssave layout script. Status: ${jsRes.status} ${jsRes.statusText}. ` +
          `Headers: ${JSON.stringify(headersObj)}. ` +
          `Body (first 500 chars): ${bodyText}`
      );
      throw new Error(
        `Failed to fetch vidssave layout script: ${jsRes.status} ${jsRes.statusText}`
      );
    }
    const jsContent = await jsRes.text();

    const authRegex = /auth=([a-zA-Z0-9_-]+)/;
    const authMatch = jsContent.match(authRegex);
    if (!authMatch || !authMatch[1]) {
      throw new Error('Could not find auth token in vidssave layout script');
    }
    const auth = authMatch[1];
    this.logger.log(`Successfully parsed new auth token: ${auth}`);
    return auth;
  }
}
