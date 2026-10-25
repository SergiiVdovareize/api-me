export interface NormalizedUrlResult {
  normalizedUrl: string;
  domain: string;
}

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'gclid',
  'fbclid',
  'yclid',
  'mc_eid',
  '_ga',
  '_gl',
  'ref',
  'source',
  'from',
  'feature',
]);

/**
 * Normalizes URL by:
 * - Validating http/https scheme
 * - Converting hostname to lowercase
 * - Stripping hash/fragment
 * - Removing UTM & common tracking query parameters
 * - Sorting remaining query parameters for canonical consistency
 * - Stripping trailing slash from root or empty paths
 */
export function normalizeProductUrl(rawUrl: string): NormalizedUrlResult {
  let trimmed = rawUrl.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }

  const parsed = new URL(trimmed);

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }

  const domain = parsed.hostname.toLowerCase().replace(/^www\./, '');
  parsed.hostname = parsed.hostname.toLowerCase();
  parsed.hash = '';

  // Filter out tracking parameters
  const remainingParams: [string, string][] = [];
  parsed.searchParams.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    if (!TRACKING_PARAMS.has(lowerKey) && !lowerKey.startsWith('utm_')) {
      remainingParams.push([key, value]);
    }
  });

  // Rebuild query search
  parsed.search = '';
  if (remainingParams.length > 0) {
    remainingParams.sort(([a], [b]) => a.localeCompare(b));
    remainingParams.forEach(([k, v]) => parsed.searchParams.append(k, v));
  }

  let normalizedUrl = parsed.toString();
  // Strip trailing slash if path is only '/' and there is no query
  if (parsed.pathname === '/' && !parsed.search && normalizedUrl.endsWith('/')) {
    normalizedUrl = normalizedUrl.slice(0, -1);
  }

  return {
    normalizedUrl,
    domain,
  };
}
