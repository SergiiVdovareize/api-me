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

    await expect(service.fetchHtml('http://example.com/403')).rejects.toThrow(
      /HTTP 403 Forbidden/
    );
  });
});
