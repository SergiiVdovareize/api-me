import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  BadGatewayException,
  Logger,
} from '@nestjs/common';

@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);
  private readonly allowedHosts = ['zetvideo.net', 'uafix.net'];

  async proxyUrl(
    targetUrl: string
  ): Promise<{ data: string; contentType: string; status: number }> {
    if (!targetUrl || typeof targetUrl !== 'string' || targetUrl.trim() === '') {
      throw new BadRequestException({ error: 'Missing "url" query parameter' });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(targetUrl.trim());
    } catch {
      throw new BadRequestException({ error: 'Invalid "url" query parameter format' });
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    const isAllowed = this.allowedHosts.some(
      host => hostname === host || hostname.endsWith(`.${host}`)
    );

    if (!isAllowed) {
      throw new ForbiddenException({ error: `Host "${hostname}" is not allowed` });
    }

    try {
      const upstreamRes = await fetch(parsedUrl.toString(), {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Referer: 'https://uafix.net/',
        },
        cache: 'no-store',
      });

      const data = await upstreamRes.text();
      const contentType = upstreamRes.headers.get('content-type') || 'text/html; charset=utf-8';

      return {
        data,
        contentType,
        status: upstreamRes.status,
      };
    } catch (error: any) {
      this.logger.error(`Upstream proxy request failed: ${error?.message || error}`);
      throw new BadGatewayException({
        error: error?.message || 'Proxy request to upstream failed',
      });
    }
  }
}
