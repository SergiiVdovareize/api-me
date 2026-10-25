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

  beforeEach(() => {
    service = new SafeFetchService();
    jest.clearAllMocks();
  });

  it('should block local loopback IP 127.0.0.1', async () => {
    mockDnsLookup.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }] as any);

    await expect(service.fetchHtml('http://localhost/test')).rejects.toThrow(
      /SSRF: Hostname "localhost" resolves to restricted IP: 127.0.0.1/
    );
  });

  it('should block AWS cloud metadata IP 169.254.169.254', async () => {
    mockDnsLookup.mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }] as any);

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

  it('should block unsupported protocols', async () => {
    await expect(service.fetchHtml('file:///etc/passwd')).rejects.toThrow(
      /SSRF: Blocked unsupported protocol "file:"/
    );
  });
});
