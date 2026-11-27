import {
  extractGeoFromHeaders,
  extractRequestDeviceMetadata,
  formatDeviceLocation,
} from './catcast-device-meta.util';

describe('catcast-device-meta.util', () => {
  describe('formatDeviceLocation', () => {
    it('formats city and country', () => {
      expect(formatDeviceLocation('Kyiv', 'UA')).toBe('Kyiv, UA');
      expect(formatDeviceLocation('Kyiv', null)).toBe('Kyiv');
      expect(formatDeviceLocation(null, 'UA')).toBe('UA');
      expect(formatDeviceLocation(null, null)).toBeNull();
    });
  });

  describe('extractGeoFromHeaders', () => {
    it('extracts and decodes Vercel geo headers', () => {
      expect(
        extractGeoFromHeaders({
          'x-vercel-ip-city': 'New%20York',
          'x-vercel-ip-country': 'us',
        })
      ).toEqual({ city: 'New York', country: 'US' });
    });

    it('falls back to Cloudflare headers and ignores XX/T1 country codes', () => {
      expect(
        extractGeoFromHeaders({
          'cf-ipcity': '%D0%9A%D0%B8%D1%97%D0%B2',
          'cf-ipcountry': 'ua',
        })
      ).toEqual({ city: 'Київ', country: 'UA' });

      expect(
        extractGeoFromHeaders({
          'cf-ipcity': '%E0%A4%A', // malformed URI component
          'cf-ipcountry': 'XX',
        })
      ).toEqual({ city: '%E0%A4%A', country: null });
    });
  });

  describe('extractRequestDeviceMetadata', () => {
    it('prefers Sec-CH-UA headers when present', () => {
      const meta = extractRequestDeviceMetadata({
        'x-vercel-ip-city': 'Lviv',
        'x-vercel-ip-country': 'UA',
        'sec-ch-ua': '"Chromium";v="131", "Google Chrome";v="131", "Not_A Brand";v="24"',
        'sec-ch-ua-platform': '"macOS"',
        'sec-ch-ua-model': '"MacBookPro18,3"',
        'user-agent': 'Mozilla/5.0 (Macintosh) Chrome/131.0.0.0',
      });

      expect(meta).toEqual({
        city: 'Lviv',
        country: 'UA',
        browser: 'Chrome 131',
        os: 'macOS',
        model: 'MacBookPro18,3',
      });
    });

    it('falls back to User-Agent parsing when Sec-CH-UA headers are absent', () => {
      const meta = extractRequestDeviceMetadata({
        'user-agent':
          'Mozilla/5.0 (Linux; Tizen 6.5; SMART-TV) AppleWebKit/537.36 Chrome/85.0.4183.93 Safari/537.36',
      });

      expect(meta).toEqual({
        city: null,
        country: null,
        os: 'Tizen',
        model: undefined,
        browser: 'Chrome 85',
      });
    });

    it('parses iOS, Android, macOS, Windows, Linux and Edge/Opera/Firefox/Safari UAs + array headers', () => {
      expect(
        extractRequestDeviceMetadata({
          'x-vercel-ip-city': ['Odessa'],
          'x-vercel-ip-country': ['ua'],
          'sec-ch-ua-platform': '"Unknown"',
          'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Safari/605.1',
        })
      ).toMatchObject({ city: 'Odessa', country: 'UA', os: 'iOS', browser: 'Safari 17.0' });

      expect(
        extractRequestDeviceMetadata({
          'user-agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 EdgA/130.0',
        })
      ).toMatchObject({ os: 'Android', browser: 'Edge 130' });

      expect(
        extractRequestDeviceMetadata({
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120.0 OPR/106.0',
        })
      ).toMatchObject({ os: 'macOS', browser: 'Opera 106' });

      expect(
        extractRequestDeviceMetadata({
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/132.0',
        })
      ).toMatchObject({ os: 'Windows', browser: 'Firefox 132' });

      expect(
        extractRequestDeviceMetadata({
          'user-agent': 'Mozilla/5.0 (X11; Linux x86_64)',
        })
      ).toMatchObject({ os: 'Linux', browser: undefined });
    });
  });
});
