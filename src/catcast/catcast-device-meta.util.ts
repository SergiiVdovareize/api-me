import { IncomingHttpHeaders } from 'http';

export interface RequestGeoMetadata {
  city: string | null;
  country: string | null;
}

export interface RequestClientMetadata {
  browser?: string;
  os?: string;
  model?: string;
}

export interface RequestDeviceMetadata extends RequestGeoMetadata, RequestClientMetadata {}

function readHeaderString(headers: IncomingHttpHeaders, name: string): string | null {
  const val = headers[name.toLowerCase()];
  if (typeof val === 'string') return val.trim() || null;
  if (Array.isArray(val) && typeof val[0] === 'string') return val[0].trim() || null;
  return null;
}

function safeDecodeComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function stripQuotes(value: string): string {
  return value.replace(/^"(.*)"$/, '$1').trim();
}

export function formatDeviceLocation(city?: string | null, country?: string | null): string | null {
  const cleanCity = city?.trim() || null;
  const cleanCountry = country?.trim() || null;
  if (cleanCity && cleanCountry) return `${cleanCity}, ${cleanCountry}`;
  return cleanCity || cleanCountry || null;
}

export function extractGeoFromHeaders(headers: IncomingHttpHeaders): RequestGeoMetadata {
  const rawCity =
    readHeaderString(headers, 'x-vercel-ip-city') || readHeaderString(headers, 'cf-ipcity');
  const rawCountry =
    readHeaderString(headers, 'x-vercel-ip-country') || readHeaderString(headers, 'cf-ipcountry');

  const city = rawCity ? safeDecodeComponent(rawCity).trim().slice(0, 120) || null : null;
  let country = rawCountry ? rawCountry.toUpperCase().slice(0, 16) : null;
  if (country === 'XX' || country === 'T1') {
    country = null;
  }

  return { city, country };
}

function parseSecChUaBrowser(secChUa: string): string | undefined {
  const parts = secChUa
    .split(',')
    .map(p => p.trim())
    .map(p => {
      const match = p.match(/^"([^"]+)";v="([^"]+)"$/);
      return match ? { brand: match[1], version: match[2] } : null;
    })
    .filter((p): p is { brand: string; version: string } => p !== null)
    .filter(p => !/not.?a.?brand/i.test(p.brand));

  const preferred =
    parts.find(p => /google chrome|microsoft edge|opera|brave|vivaldi|yandex/i.test(p.brand)) ||
    parts.find(p => /chromium/i.test(p.brand)) ||
    parts[0];

  if (!preferred) return undefined;
  const brand = preferred.brand.replace(/^Google\s+/i, '').replace(/^Microsoft\s+/i, '');
  return `${brand} ${preferred.version}`.slice(0, 80);
}

function parseUserAgentFallback(ua: string): RequestClientMetadata {
  const result: RequestClientMetadata = {};

  if (/Tizen/i.test(ua)) {
    result.os = 'Tizen';
  } else if (/iPhone|iPad|iPod/i.test(ua)) {
    result.os = 'iOS';
  } else if (/Android/i.test(ua)) {
    result.os = 'Android';
  } else if (/Mac OS X|Macintosh/i.test(ua)) {
    result.os = 'macOS';
  } else if (/Windows/i.test(ua)) {
    result.os = 'Windows';
  } else if (/Linux/i.test(ua)) {
    result.os = 'Linux';
  }

  const edgeMatch = ua.match(/Edg(?:A|iOS)?\/(\d+)/);
  const oprMatch = ua.match(/OPR\/(\d+)/);
  const chromeMatch = ua.match(/(?:Chrome|CriOS)\/(\d+)/);
  const firefoxMatch = ua.match(/(?:Firefox|FxiOS)\/(\d+)/);
  const safariMatch = ua.match(/Version\/(\d+(?:\.\d+)?).*Safari\//);

  if (edgeMatch) {
    result.browser = `Edge ${edgeMatch[1]}`;
  } else if (oprMatch) {
    result.browser = `Opera ${oprMatch[1]}`;
  } else if (chromeMatch) {
    result.browser = `Chrome ${chromeMatch[1]}`;
  } else if (firefoxMatch) {
    result.browser = `Firefox ${firefoxMatch[1]}`;
  } else if (safariMatch) {
    result.browser = `Safari ${safariMatch[1]}`;
  }

  return result;
}

export function extractRequestDeviceMetadata(headers: IncomingHttpHeaders): RequestDeviceMetadata {
  const geo = extractGeoFromHeaders(headers);

  const secPlatform = readHeaderString(headers, 'sec-ch-ua-platform');
  const secModel = readHeaderString(headers, 'sec-ch-ua-model');
  const secUa = readHeaderString(headers, 'sec-ch-ua');
  const ua = readHeaderString(headers, 'user-agent');

  const uaFallback = ua ? parseUserAgentFallback(ua) : {};

  const osRaw = secPlatform ? stripQuotes(secPlatform) : undefined;
  const modelRaw = secModel ? stripQuotes(secModel) : undefined;
  const browserRaw = secUa ? parseSecChUaBrowser(secUa) : undefined;

  return {
    city: geo.city,
    country: geo.country,
    os: (osRaw && osRaw !== 'Unknown' ? osRaw : uaFallback.os)?.slice(0, 128),
    model: modelRaw ? modelRaw.slice(0, 128) : undefined,
    browser: (browserRaw || uaFallback.browser)?.slice(0, 80),
  };
}
