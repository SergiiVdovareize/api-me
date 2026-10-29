import { SafeFetchService } from './safe-fetch.service';
import * as dns from 'dns';

jest.mock('dns', () => ({
  promises: {
    lookup: jest.fn(),
  },
}));

describe('SafeFetchService', () => {
  let service: SafeFetchService;
  const mockDnsLookup = dns.promises.lookup as jest.MockedFunction<typeof dns.promises.lookup>;
  const originalFetch = global.fetch;

  beforeEach(() => {
    service = new SafeFetchService();
    jest.clearAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('should block local loopback IP 127.0.0.1', async () => {
    mockDnsLookup.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }] as any);

    await expect(service.fetchHtml('http://localhost/test')).rejects.toThrow(
      /SSRF: Hostname "localhost" resolves to restricted IP: 127.0.0.1/
    );
  });

  it('should block AWS cloud metadata IP 169.254.169.254', async () => {
    await expect(service.fetchHtml('http://169.254.169.254/latest/meta-data')).rejects.toThrow(
      /SSRF: Blocked direct private\/restricted IP/
    );
  });

  it('should block private network IP 192.168.1.1', async () => {
    mockDnsLookup.mockResolvedValueOnce([{ address: '192.168.1.1', family: 4 }] as any);

    await expect(service.fetchHtml('http://router.local/admin')).rejects.toThrow(
      /SSRF: Hostname "router.local" resolves to restricted IP: 192.168.1.1/
    );
  });

  it('should block IPv6 loopback and link-local', async () => {
    await expect(service.fetchHtml('http://[::1]/admin')).rejects.toThrow(
      /SSRF: Blocked direct private\/restricted IP/
    );
    await expect(service.fetchHtml('http://[fe80::1]/admin')).rejects.toThrow(
      /SSRF: Blocked direct private\/restricted IP/
    );
  });

  it('should block unsupported protocols', async () => {
    await expect(service.fetchHtml('file:///etc/passwd')).rejects.toThrow(
      /SSRF: Blocked unsupported protocol "file:"/
    );
  });

  it('should throw error when Content-Type is not HTML', async () => {
    mockDnsLookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }] as any);

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: {
        get: (h: string) => (h === 'content-type' ? 'application/json' : null),
      },
      text: jest.fn().mockResolvedValue('{"hello":"world"}'),
    } as any);

    await expect(service.fetchHtml('http://example.com/api')).rejects.toThrow(
      /Unsupported content-type/
    );
  });

  it('should successfully fetch HTML when all validations pass', async () => {
    mockDnsLookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }] as any);

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: {
        get: (h: string) => (h === 'content-type' ? 'text/html; charset=utf-8' : null),
      },
      text: jest.fn().mockResolvedValue('<html><body>Success</body></html>'),
    } as any);

    const html = await service.fetchHtml('http://example.com/product');
    expect(html).toContain('Success');
  });

  it('should block various restricted IPv4 ranges and mapped IPv6', async () => {
    const restrictedIps = [
      '100.64.0.1',
      '172.20.1.1',
      '192.0.0.1',
      '198.18.1.1',
      '198.51.100.1',
      '203.0.113.1',
      '224.0.0.1',
      '240.0.0.1',
    ];

    for (const ip of restrictedIps) {
      await expect(service.fetchHtml(`http://${ip}/item`)).rejects.toThrow(
        /SSRF: Blocked direct private\/restricted IP/
      );
    }

    mockDnsLookup.mockResolvedValueOnce([{ address: '::ffff:192.168.1.1', family: 6 }] as any);
    await expect(service.fetchHtml('http://mapped.local/item')).rejects.toThrow(
      /resolves to restricted IP/
    );
  });

  it('should handle stream reading and enforce maxSizeBytes limit', async () => {
    mockDnsLookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }] as any);

    const chunk1 = Buffer.from('<html>');
    const chunk2 = Buffer.from('<body>chunked</body></html>');

    const mockReader = {
      read: jest
        .fn()
        .mockResolvedValueOnce({ done: false, value: chunk1 })
        .mockResolvedValueOnce({ done: false, value: chunk2 })
        .mockResolvedValueOnce({ done: true }),
      cancel: jest.fn().mockResolvedValue(undefined),
    };

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: {
        get: (h: string) => (h === 'content-type' ? 'text/html' : null),
      },
      body: {
        getReader: () => mockReader,
      },
    } as any);

    const result = await service.fetchHtml('http://example.com/stream');
    expect(result).toBe('<html><body>chunked</body></html>');
  });

  it('should throw error when stream chunks exceed maxSizeBytes', async () => {
    mockDnsLookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }] as any);

    const hugeChunk = Buffer.alloc(3000);
    const mockReader = {
      read: jest.fn().mockResolvedValueOnce({ done: false, value: hugeChunk }),
      cancel: jest.fn().mockResolvedValue(undefined),
    };

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: {
        get: (h: string) => (h === 'content-type' ? 'text/html' : null),
      },
      body: {
        getReader: () => mockReader,
      },
    } as any);

    await expect(
      service.fetchHtml('http://example.com/stream', { maxSizeBytes: 2000 })
    ).rejects.toThrow(/Response body exceeds maximum allowed size/);
  });

  it('should throw error when fallback text length exceeds maxSizeBytes', async () => {
    mockDnsLookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }] as any);

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: {
        get: (h: string) => (h === 'content-type' ? 'text/html' : null),
      },
      text: jest.fn().mockResolvedValue('a'.repeat(2500)),
    } as any);

    await expect(
      service.fetchHtml('http://example.com/text', { maxSizeBytes: 2000 })
    ).rejects.toThrow(/Response size exceeds limit/);
  });

  it('should throw error on timeout, redirect errors, or HTTP failure statuses', async () => {
    mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);

    const abortError = new Error('Abort');
    abortError.name = 'AbortError';
    global.fetch = jest.fn().mockRejectedValueOnce(abortError);

    await expect(service.fetchHtml('http://example.com/timeout')).rejects.toThrow(
      /Request timed out/
    );

    global.fetch = jest.fn().mockResolvedValueOnce({
      status: 302,
      headers: { get: () => null },
    } as any);

    await expect(service.fetchHtml('http://example.com/redirect-no-loc')).rejects.toThrow(
      /Redirect status 302 without Location header/
    );

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      headers: { get: () => null },
    } as any);

    await expect(service.fetchHtml('http://example.com/403')).rejects.toThrow(/HTTP 403 Forbidden/);
  });

  it('should retry transient errors when maxRetries is provided and succeed', async () => {
    mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: { get: () => null },
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (h: string) => (h === 'content-type' ? 'text/html' : null),
        },
        text: jest.fn().mockResolvedValue('<html>Success on retry</html>'),
      } as any);

    const html = await service.fetchHtml('http://example.com/retry', { maxRetries: 1 });
    expect(html).toContain('Success on retry');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  describe('WAF Proxy Fallbacks', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);
    });

    afterAll(() => {
      process.env = originalEnv;
    });

    it('should fall back to ScrapingAnt with browser=false when direct fetch gets 403', async () => {
      process.env.SCRAPINGANT_API_KEY = 'ant-test-key';

      global.fetch = jest
        .fn()
        // 1. Direct fetch returns 403 Forbidden
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          headers: { get: () => 'ray-123' },
        } as any)
        // 2. ScrapingAnt call returns 200 with HTML
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: jest.fn().mockResolvedValue('<html>ScrapingAnt Content</html>'),
        } as any);

      const html = await service.fetchHtml('http://example.com/blocked');
      expect(html).toBe('<html>ScrapingAnt Content</html>');
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(global.fetch).toHaveBeenLastCalledWith(
        expect.stringContaining('api.scrapingant.com/v2/general?url='),
        expect.objectContaining({
          headers: expect.objectContaining({ 'x-api-key': 'ant-test-key' }),
        })
      );
    });

    it('should retry ScrapingAnt with browser=true when browser=false returns 422', async () => {
      process.env.SCRAPINGANT_API_KEY = 'ant-test-key';

      global.fetch = jest
        .fn()
        // 1. Direct fetch returns 403
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          headers: { get: () => null },
        } as any)
        // 2. ScrapingAnt browser=false returns 423 Locked (anti-bot challenge)
        .mockResolvedValueOnce({
          ok: false,
          status: 423,
          statusText: 'Locked',
        } as any)
        // 3. ScrapingAnt browser=true returns 200
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: jest.fn().mockResolvedValue('<html>Rendered with Browser</html>'),
        } as any);

      const html = await service.fetchHtml('http://example.com/js-challenge');
      expect(html).toBe('<html>Rendered with Browser</html>');
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    it('should fall back to Scrape.do when SCRAPEDO_API_KEY is configured and direct fetch gets 403', async () => {
      delete process.env.SCRAPINGANT_API_KEY;
      process.env.SCRAPEDO_API_KEY = 'scrapedo-test-key';

      global.fetch = jest
        .fn()
        // 1. Direct fetch returns 403
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          headers: { get: () => null },
        } as any)
        // 2. Scrape.do call returns 200
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: jest.fn().mockResolvedValue('<html>Scrape.do Content</html>'),
        } as any);

      const html = await service.fetchHtml('http://example.com/scrapedo-blocked');
      expect(html).toBe('<html>Scrape.do Content</html>');
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(global.fetch).toHaveBeenLastCalledWith(
        expect.stringContaining('api.scrape.do/?token=scrapedo-test-key'),
        expect.any(Object)
      );
    });

    it('should fall back to Scrape.do when ScrapingAnt fails and SCRAPEDO_API_KEY is set', async () => {
      process.env.SCRAPINGANT_API_KEY = 'ant-key';
      process.env.SCRAPEDO_API_KEY = 'scrapedo-key';

      global.fetch = jest
        .fn()
        // 1. Direct fetch returns 403
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          headers: { get: () => null },
        } as any)
        // 2. ScrapingAnt browser=false returns 423
        .mockResolvedValueOnce({
          ok: false,
          status: 423,
          statusText: 'Locked',
        } as any)
        // 3. ScrapingAnt browser=true fails with 423
        .mockResolvedValueOnce({
          ok: false,
          status: 423,
          statusText: 'Locked',
        } as any)
        // 4. Scrape.do fallback succeeds
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: jest.fn().mockResolvedValue('<html>Scrape.do Fallback Succeeded</html>'),
        } as any);

      const html = await service.fetchHtml('http://example.com/cascade-test');
      expect(html).toBe('<html>Scrape.do Fallback Succeeded</html>');
    });

    it('should retry Scrape.do with render=true when direct mode returns 403', async () => {
      delete process.env.SCRAPINGANT_API_KEY;
      process.env.SCRAPEDO_API_KEY = 'scrapedo-key';

      global.fetch = jest
        .fn()
        // 1. Direct fetch returns 403
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          headers: { get: () => null },
        } as any)
        // 2. Scrape.do direct mode returns 403
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
        } as any)
        // 3. Scrape.do render=true returns 200
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: jest.fn().mockResolvedValue('<html>Rendered with Scrape.do</html>'),
        } as any);

      const html = await service.fetchHtml('http://example.com/render-test');
      expect(html).toBe('<html>Rendered with Scrape.do</html>');
    });
  });
});
