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
});
