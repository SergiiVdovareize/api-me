import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class VidssaveTokenParser {
  private readonly logger = new Logger(VidssaveTokenParser.name);

  async parseToken(): Promise<string> {
    this.logger.log('Fetching vidssave landing page to find layout script...');
    const landingRes = await fetch('https://vidssave.com/youtube-video-downloader-6fu');
    if (!landingRes.ok) {
      throw new Error(`Failed to fetch vidssave landing page: ${landingRes.statusText}`);
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
    const jsRes = await fetch(scriptUrl);
    if (!jsRes.ok) {
      throw new Error(`Failed to fetch vidssave layout script: ${jsRes.statusText}`);
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
