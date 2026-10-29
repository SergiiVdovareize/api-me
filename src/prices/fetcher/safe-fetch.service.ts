import { Injectable, Logger } from '@nestjs/common';
import * as dns from 'dns';
import * as net from 'net';

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxRedirects?: number;
  maxSizeBytes?: number;
  maxRetries?: number;
}

@Injectable()
export class SafeFetchService {
  private readonly logger = new Logger(SafeFetchService.name);

  private readonly defaultTimeoutMs = 15000;
  private readonly defaultMaxRedirects = 3;
  private readonly defaultMaxSizeBytes = 2 * 1024 * 1024; // 2 MB
  private readonly defaultMaxRetries = 0;

  private readonly userAgent =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

  /**
   * Performs an SSRF-safe HTTP GET request, checking DNS against private/local ranges,
   * enforcing redirects limit, response size limit, and timeout. Retries on transient errors if maxRetries > 0.
   */
  async fetchHtml(url: string, options?: SafeFetchOptions): Promise<string> {
    const maxRetries = options?.maxRetries ?? this.defaultMaxRetries;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.fetchHtmlOnce(url, options);
      } catch (err: any) {
        lastError = err;
        const msg = String(err?.message || '');
        const isTransient =
          err?.name === 'AbortError' ||
          msg.includes('timed out') ||
          msg.includes('fetch failed') ||
          msg.includes('HTTP 429') ||
          msg.includes('HTTP 502') ||
          msg.includes('HTTP 503') ||
          msg.includes('HTTP 504');

        if (attempt < maxRetries && isTransient) {
          const delayMs = 500 * Math.pow(2, attempt);
          this.logger.warn(
            `Transient error fetching ${url} (attempt ${attempt + 1}/${maxRetries + 1}): ${msg}. Retrying in ${delayMs}ms...`
          );
          await new Promise(res => setTimeout(res, delayMs));
          continue;
        }

        // If direct fetch is blocked by WAF/Cloudflare (HTTP 403), check for ScrapingAnt or Scrape.do fallback
        const isWafBlock =
          msg.includes('403') ||
          msg.toLowerCase().includes('forbidden') ||
          msg.includes('Cloudflare');

        if (isWafBlock) {
          const scrapingAntKey = process.env.SCRAPINGANT_API_KEY?.trim();
          const scrapeDoToken =
            process.env.SCRAPEDO_API_KEY?.trim() || process.env.SCRAPE_DO_TOKEN?.trim();

          // 1. Try ScrapingAnt first if configured (10,000 monthly credits)
          if (scrapingAntKey) {
            this.logger.warn(
              `Direct fetch for ${url} was blocked by WAF (${msg}). Trying ScrapingAnt proxy...`
            );
            try {
              return await this.fetchViaScrapingAnt(url, scrapingAntKey, options);
            } catch (saErr: any) {
              this.logger.warn(
                `ScrapingAnt proxy failed for ${url} (${saErr.message}). Falling back to Scrape.do...`
              );
            }
          }

          // 2. Try Scrape.do fallback (supports geoCode=ua for Ukrainian Cloudflare rules)
          if (scrapeDoToken) {
            this.logger.warn(
              `Direct fetch for ${url} was blocked by WAF (${msg}). Trying Scrape.do proxy (geoCode=ua)...`
            );
            try {
              return await this.fetchViaScrapeDo(url, scrapeDoToken, options);
            } catch (sdErr: any) {
              this.logger.error(`Scrape.do proxy failed for ${url}: ${sdErr.message}`);
              throw sdErr;
            }
          }
        }

        throw err;
      }
    }

    throw lastError || new Error(`Failed to fetch HTML from ${url}`);
  }

  private async fetchHtmlOnce(url: string, options?: SafeFetchOptions): Promise<string> {
    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
    const maxRedirects = options?.maxRedirects ?? this.defaultMaxRedirects;
    const maxSizeBytes = options?.maxSizeBytes ?? this.defaultMaxSizeBytes;

    let currentUrl = url;
    let redirectCount = 0;

    while (redirectCount <= maxRedirects) {
      const parsed = new URL(currentUrl);

      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`SSRF: Blocked unsupported protocol "${parsed.protocol}"`);
      }

      // 1. DNS check for private/forbidden IPs
      await this.validateHostIp(parsed.hostname);

      // 2. Perform fetch with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      let response: Response;
      try {
        response = await fetch(currentUrl, {
          method: 'GET',
          redirect: 'manual', // Manual redirect to validate every hop
          signal: controller.signal,
          headers: {
            'User-Agent': this.userAgent,
            Accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7',
            'Sec-Ch-Ua': '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"macOS"',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1',
            'Cache-Control': 'no-cache',
          },
        });
      } catch (err: any) {
        if (err.name === 'AbortError') {
          throw new Error(`Request timed out after ${timeoutMs}ms for ${currentUrl}`);
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response) {
        throw new Error(`Failed to fetch ${currentUrl}: No response received`);
      }

      // 3. Handle redirects manually
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          throw new Error(`Redirect status ${response.status} without Location header`);
        }
        redirectCount++;
        if (redirectCount > maxRedirects) {
          throw new Error(`Too many redirects (exceeded ${maxRedirects})`);
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      if (!response.ok) {
        const cfRay = response.headers.get('cf-ray');
        const cfExtra = cfRay ? ` (Cloudflare Ray: ${cfRay})` : '';
        throw new Error(`HTTP ${response.status} ${response.statusText}${cfExtra} for ${currentUrl}`);
      }

      // 4. Verify Content-Type
      const contentType = response.headers.get('content-type') || '';
      if (
        !contentType.includes('text/html') &&
        !contentType.includes('application/xhtml+xml') &&
        !contentType.includes('text/plain')
      ) {
        throw new Error(`Unsupported content-type "${contentType}", expected HTML`);
      }

      // 5. Read body with size limit
      return await this.readBodyWithLimit(response, maxSizeBytes);
    }

    throw new Error(`Exceeded maximum redirects (${maxRedirects})`);
  }

  /**
   * Resolves hostname and validates that none of the resolved IPs belong to private/loopback/cloud-metadata ranges.
   */
  private async validateHostIp(hostname: string): Promise<void> {
    // If hostname is directly an IP (strip IPv6 brackets if present)
    const rawIp =
      hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
    if (net.isIP(rawIp)) {
      if (this.isPrivateOrRestrictedIp(rawIp)) {
        throw new Error(`SSRF: Blocked direct private/restricted IP: ${hostname}`);
      }
      return;
    }

    // DNS lookup
    const addresses = await dns.promises.lookup(hostname, { all: true });
    if (!addresses || addresses.length === 0) {
      throw new Error(`SSRF: DNS resolution returned no addresses for ${hostname}`);
    }

    for (const record of addresses) {
      if (this.isPrivateOrRestrictedIp(record.address)) {
        throw new Error(
          `SSRF: Hostname "${hostname}" resolves to restricted IP: ${record.address}`
        );
      }
    }
  }

  /**
   * Checks if an IP is in private, loopback, link-local, carrier-grade NAT, or cloud metadata ranges.
   */
  private isPrivateOrRestrictedIp(ip: string): boolean {
    // Check IPv6
    if (net.isIPv6(ip)) {
      const lower = ip.toLowerCase();
      // Loopback (::1) or unspecified (::)
      if (lower === '::1' || lower === '::') return true;
      // IPv4 mapped IPv6 (::ffff:127.0.0.1)
      if (lower.startsWith('::ffff:')) {
        const ipv4Part = lower.replace('::ffff:', '');
        if (net.isIPv4(ipv4Part)) {
          return this.isPrivateOrRestrictedIp(ipv4Part);
        }
      }
      // Unique local address (fc00::/7)
      if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
      // Link-local address (fe80::/10)
      if (
        lower.startsWith('fe8') ||
        lower.startsWith('fe9') ||
        lower.startsWith('fea') ||
        lower.startsWith('feb')
      ) {
        return true;
      }
      // Multicast (ff00::/8)
      if (lower.startsWith('ff')) return true;
      return false;
    }

    // Check IPv4
    if (net.isIPv4(ip)) {
      const parts = ip.split('.').map(p => parseInt(p, 10));
      const [a, b] = parts;

      // 0.0.0.0/8 (current network)
      if (a === 0) return true;
      // 10.0.0.0/8 (private)
      if (a === 10) return true;
      // 100.64.0.0/10 (Carrier-grade NAT)
      if (a === 100 && b >= 64 && b <= 127) return true;
      // 127.0.0.0/8 (loopback)
      if (a === 127) return true;
      // 169.254.0.0/16 (link-local, cloud metadata: 169.254.169.254)
      if (a === 169 && b === 254) return true;
      // 172.16.0.0/12 (private)
      if (a === 172 && b >= 16 && b <= 31) return true;
      // 192.0.0.0/24 (IETF protocol assignments)
      if (a === 192 && b === 0) return true;
      // 192.0.2.0/24 (TEST-NET-1)
      if (a === 192 && b === 0 && parts[2] === 2) return true;
      // 192.168.0.0/16 (private)
      if (a === 192 && b === 168) return true;
      // 198.18.0.0/15 (benchmarking)
      if (a === 198 && (b === 18 || b === 19)) return true;
      // 198.51.100.0/24 (TEST-NET-2)
      if (a === 198 && b === 51 && parts[2] === 100) return true;
      // 203.0.113.0/24 (TEST-NET-3)
      if (a === 203 && b === 0 && parts[2] === 113) return true;
      // 224.0.0.0/4 (multicast)
      if (a >= 224 && a <= 239) return true;
      // 240.0.0.0/4 (reserved) & 255.255.255.255 (broadcast)
      if (a >= 240) return true;

      return false;
    }

    return true; // If unknown format, treat as restricted
  }

  /**
   * Reads response stream ensuring total size does not exceed maxSizeBytes.
   */
  private async readBodyWithLimit(response: Response, maxSizeBytes: number): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) {
      const text = await response.text();
      if (text.length > maxSizeBytes) {
        throw new Error(`Response size exceeds limit of ${maxSizeBytes} bytes`);
      }
      return text;
    }

    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      if (value) {
        receivedBytes += value.length;
        if (receivedBytes > maxSizeBytes) {
          reader.cancel().catch(() => {});
          throw new Error(`Response body exceeds maximum allowed size of ${maxSizeBytes} bytes`);
        }
        chunks.push(value);
      }
    }

    const totalBuffer = Buffer.concat(chunks);
    return totalBuffer.toString('utf-8');
  }

  /**
   * Fetches the page through ScrapingAnt API proxy to bypass Cloudflare/WAF.
   */
  async fetchViaScrapingAnt(
    url: string,
    apiKey: string,
    options?: SafeFetchOptions
  ): Promise<string> {
    const timeoutMs = options?.timeoutMs ?? 60000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // Try browser=false first (costs only 1 credit instead of 10)
    const endpoint = new URL('https://api.scrapingant.com/v2/general');
    endpoint.searchParams.set('url', url);
    endpoint.searchParams.set('browser', 'false');

    try {
      this.logger.log(`Fetching ${url} via ScrapingAnt (browser=false)...`);
      const response = await fetch(endpoint.toString(), {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        // If challenged or blocked with browser=false (403, 422, or 423 Locked), retry with browser=true
        if (response.status === 422 || response.status === 403 || response.status === 423) {
          this.logger.warn(
            `ScrapingAnt browser=false returned ${response.status}. Retrying with browser=true...`
          );
          const browserEndpoint = new URL('https://api.scrapingant.com/v2/general');
          browserEndpoint.searchParams.set('url', url);
          browserEndpoint.searchParams.set('browser', 'true');

          const browserController = new AbortController();
          const browserTimeoutId = setTimeout(() => browserController.abort(), timeoutMs);

          try {
            const browserResponse = await fetch(browserEndpoint.toString(), {
              method: 'GET',
              headers: {
                'x-api-key': apiKey,
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              },
              signal: browserController.signal,
            });

            if (!browserResponse.ok) {
              throw new Error(
                `ScrapingAnt returned HTTP ${browserResponse.status} ${browserResponse.statusText}`
              );
            }
            return await browserResponse.text();
          } finally {
            clearTimeout(browserTimeoutId);
          }
        }

        throw new Error(`ScrapingAnt returned HTTP ${response.status} ${response.statusText}`);
      }

      return await response.text();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Fetches the page through Scrape.do API proxy with automated Cloudflare/WAF bypass.
   */
  async fetchViaScrapeDo(
    url: string,
    token: string,
    options?: SafeFetchOptions
  ): Promise<string> {
    const timeoutMs = options?.timeoutMs ?? 30000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // Try default smart routing first (1 credit, fast)
    const endpoint = new URL('https://api.scrape.do/');
    endpoint.searchParams.set('token', token);
    endpoint.searchParams.set('url', url);

    try {
      this.logger.log(`Fetching ${url} via Scrape.do proxy...`);
      const response = await fetch(endpoint.toString(), {
        method: 'GET',
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        // If challenged without render (403, 422, or 423), retry with render=true
        if (response.status === 403 || response.status === 422 || response.status === 423) {
          this.logger.warn(
            `Scrape.do direct mode returned ${response.status}. Retrying with render=true...`
          );
          const renderEndpoint = new URL('https://api.scrape.do/');
          renderEndpoint.searchParams.set('token', token);
          renderEndpoint.searchParams.set('url', url);
          renderEndpoint.searchParams.set('render', 'true');

          const renderController = new AbortController();
          const renderTimeoutId = setTimeout(() => renderController.abort(), timeoutMs);

          try {
            const renderResponse = await fetch(renderEndpoint.toString(), {
              method: 'GET',
              headers: {
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              },
              signal: renderController.signal,
            });

            if (!renderResponse.ok) {
              throw new Error(
                `Scrape.do returned HTTP ${renderResponse.status} ${renderResponse.statusText}`
              );
            }
            return await renderResponse.text();
          } finally {
            clearTimeout(renderTimeoutId);
          }
        }

        throw new Error(`Scrape.do returned HTTP ${response.status} ${response.statusText}`);
      }

      return await response.text();
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
