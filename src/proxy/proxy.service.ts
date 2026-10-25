import {
  Injectable,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import {
  DEFAULT_OUTBOUND_HEADERS,
  FORWARDED_RESPONSE_HEADERS,
  PROXY_CONFIG,
  PROXY_ERROR_MESSAGES,
  applyProxyCorsHeaders,
  getDomainHeaders,
  isAllowedProxyDomain,
} from './proxy.constants';

@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);

  async handleProxy(req: Request, res: Response): Promise<void> {
    const rawTarget = req.query[PROXY_CONFIG.QUERY_PARAM_URL];
    if (!rawTarget || typeof rawTarget !== 'string' || rawTarget.trim() === '') {
      throw new BadRequestException(PROXY_ERROR_MESSAGES.URL_REQUIRED);
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawTarget.trim());
    } catch {
      throw new BadRequestException(PROXY_ERROR_MESSAGES.INVALID_URL);
    }

    if (!isAllowedProxyDomain(parsedUrl.hostname)) {
      throw new BadRequestException(
        PROXY_ERROR_MESSAGES.DOMAIN_NOT_ALLOWED(parsedUrl.hostname)
      );
    }

    return this.forwardStream(rawTarget.trim(), req, res);
  }

  private forwardStream(
    targetUrl: string,
    req: Request,
    res: Response,
    maxRedirects: number = PROXY_CONFIG.MAX_REDIRECTS
  ): Promise<void> {
    return new Promise(resolve => {
      if (maxRedirects <= 0) {
        if (!res.headersSent) {
          applyProxyCorsHeaders(res);
          res.status(502).json({ error: PROXY_ERROR_MESSAGES.TOO_MANY_REDIRECTS });
        }
        return resolve();
      }

      const parsed = new URL(targetUrl);

      const client = parsed.protocol === 'https:' ? https : http;

      if (!isAllowedProxyDomain(parsed.hostname)) {
        if (!res.headersSent) {
          applyProxyCorsHeaders(res);
          res.status(403).json({
            error: PROXY_ERROR_MESSAGES.REDIRECT_NOT_ALLOWED(parsed.hostname),
          });
        }
        return resolve();
      }

      const domainHeaders = getDomainHeaders(parsed.hostname);
      const outboundHeaders: Record<string, string> = {
        ...DEFAULT_OUTBOUND_HEADERS,
        Referer: domainHeaders.referer,
        Origin: domainHeaders.origin,
      };

      const incomingRange = req.headers['range'];
      if (incomingRange) {
        outboundHeaders['Range'] = Array.isArray(incomingRange) ? incomingRange[0] : incomingRange;
      }

      const upstreamReq = client.request(
        targetUrl,
        { method: 'GET', headers: outboundHeaders },
        upstreamRes => {
          // Handle redirects (301, 302, 307, 308)
          if (
            upstreamRes.statusCode &&
            upstreamRes.statusCode >= 300 &&
            upstreamRes.statusCode < 400 &&
            upstreamRes.headers.location
          ) {
            let nextUrl: string;
            try {
              nextUrl = new URL(upstreamRes.headers.location, targetUrl).toString();
            } catch {
              if (!res.headersSent) {
                applyProxyCorsHeaders(res);
                res.status(400).json({ error: PROXY_ERROR_MESSAGES.INVALID_REDIRECT_URL });
              }
              return resolve();
            }
            return this.forwardStream(nextUrl, req, res, maxRedirects - 1).then(resolve);
          }

          applyProxyCorsHeaders(res);

          for (const header of FORWARDED_RESPONSE_HEADERS) {
            const headerVal = upstreamRes.headers[header.incoming];
            if (headerVal) {
              res.setHeader(header.outgoing, headerVal);
            }
          }

          res.status(upstreamRes.statusCode || 200);

          upstreamRes.pipe(res);
          upstreamRes.on('end', () => resolve());
          upstreamRes.on('error', err => {
            this.logger.error(`Upstream response stream error: ${err.message}`);
            if (!res.headersSent) {
              applyProxyCorsHeaders(res);
              res.status(502).json({
                error: PROXY_ERROR_MESSAGES.STREAM_ERROR,
                details: err.message,
              });
            }
            resolve();
          });
        }
      );

      req.on('close', () => {
        upstreamReq.destroy();
      });

      upstreamReq.on('error', err => {
        this.logger.error(`Upstream proxy request failed: ${err.message}`);
        if (!res.headersSent) {
          applyProxyCorsHeaders(res);
          res.status(502).json({
            error: PROXY_ERROR_MESSAGES.PROXY_FAILED,
            details: err.message,
          });
        }
        resolve();
      });

      upstreamReq.end();
    });
  }
}
