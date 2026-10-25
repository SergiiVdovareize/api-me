import { Response } from 'express';

export interface DomainHeaderRule {
  readonly matchDomains: readonly string[];
  readonly referer: string;
  readonly origin: string;
}

export const PROXY_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
} as const;

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

export const DEFAULT_OUTBOUND_HEADERS = {
  'User-Agent': DEFAULT_USER_AGENT,
  Accept: '*/*',
} as const;

export const PROXY_DOMAIN_RULES: readonly DomainHeaderRule[] = [
  {
    matchDomains: ['ashdi.vip'],
    referer: 'https://ashdi.vip/',
    origin: 'https://ashdi.vip',
  },
  {
    matchDomains: ['club.uakino.fun'],
    referer: 'https://club.uakino.fun/',
    origin: 'https://club.uakino.fun',
  },
  {
    matchDomains: ['zetvideo.net', 'uafix.net'],
    referer: 'https://uafix.net/',
    origin: 'https://uafix.net',
  },
] as const;

export const ALLOWED_PROXY_DOMAINS: readonly string[] = PROXY_DOMAIN_RULES.flatMap(
  rule => rule.matchDomains
);

export const PROXY_CONFIG = {
  MAX_REDIRECTS: 5,
  QUERY_PARAM_URL: 'url',
  ROUTES: ['proxy', 'api/proxy'],
} as const;

export const FORWARDED_RESPONSE_HEADERS: readonly {
  incoming: string;
  outgoing: string;
}[] = [
  { incoming: 'content-type', outgoing: 'Content-Type' },
  { incoming: 'content-length', outgoing: 'Content-Length' },
  { incoming: 'content-range', outgoing: 'Content-Range' },
  { incoming: 'accept-ranges', outgoing: 'Accept-Ranges' },
] as const;

export const PROXY_ERROR_MESSAGES = {
  URL_REQUIRED: 'Query parameter "url" is required',
  INVALID_URL: 'Invalid URL format',
  DOMAIN_NOT_ALLOWED: (domain: string) => `Domain ${domain} is not allowed`,
  REDIRECT_NOT_ALLOWED: (domain: string) => `Redirect to domain "${domain}" is not allowed`,
  INVALID_REDIRECT_URL: 'Invalid redirect URL',
  TOO_MANY_REDIRECTS: 'Too many redirects',
  PROXY_FAILED: 'Proxy request failed',
  STREAM_ERROR: 'Stream error',
} as const;

export function isAllowedProxyDomain(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return ALLOWED_PROXY_DOMAINS.some(
    domain => normalized === domain || normalized.endsWith(`.${domain}`)
  );
}

export function getDomainHeaders(hostname: string): { referer: string; origin: string } {
  const normalized = hostname.toLowerCase();
  const matchedRule = PROXY_DOMAIN_RULES.find(rule =>
    rule.matchDomains.some(domain => normalized === domain || normalized.endsWith(`.${domain}`))
  );

  if (matchedRule) {
    return {
      referer: matchedRule.referer,
      origin: matchedRule.origin,
    };
  }

  return {
    referer: 'https://ashdi.vip/',
    origin: 'https://ashdi.vip',
  };
}

export function applyProxyCorsHeaders(res: Response): void {
  for (const [header, value] of Object.entries(PROXY_CORS_HEADERS)) {
    res.setHeader(header, value);
  }
}
