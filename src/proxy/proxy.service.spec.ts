import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, BadGatewayException } from '@nestjs/common';
import { ProxyService } from './proxy.service';

describe('ProxyService', () => {
  let service: ProxyService;
  const originalFetch = global.fetch;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProxyService],
    }).compile();

    service = module.get<ProxyService>(ProxyService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should throw BadRequestException if targetUrl is empty or missing', async () => {
    await expect(service.proxyUrl('')).rejects.toThrow(BadRequestException);
    await expect(service.proxyUrl('   ')).rejects.toThrow(BadRequestException);
    await expect(service.proxyUrl(null as any)).rejects.toThrow(BadRequestException);
  });

  it('should throw BadRequestException if targetUrl is not a valid URL', async () => {
    await expect(service.proxyUrl('not-a-valid-url')).rejects.toThrow(BadRequestException);
  });

  it('should throw ForbiddenException if host is not whitelisted', async () => {
    await expect(service.proxyUrl('https://google.com')).rejects.toThrow(ForbiddenException);
    await expect(service.proxyUrl('https://evil.zetvideo.net.attacker.com')).rejects.toThrow(
      ForbiddenException
    );
  });

  it('should forward upstream request with required headers for zetvideo.net', async () => {
    const mockHtml = '<html><body>player</body></html>';
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      text: jest.fn().mockResolvedValue(mockHtml),
    });

    const result = await service.proxyUrl('https://zetvideo.net/vod/1122');

    expect(global.fetch).toHaveBeenCalledWith('https://zetvideo.net/vod/1122', {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Referer: 'https://uafix.net/',
      },
      cache: 'no-store',
    });

    expect(result).toEqual({
      data: mockHtml,
      contentType: 'text/html; charset=utf-8',
      status: 200,
    });
  });

  it('should allow subdomain of whitelisted host (e.g. sub.uafix.net)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      headers: new Headers(),
      text: jest.fn().mockResolvedValue('ok'),
    });

    const result = await service.proxyUrl('https://api.uafix.net/info');
    expect(result.status).toBe(200);
  });

  it('should throw BadGatewayException if fetch throws an error', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

    await expect(service.proxyUrl('https://zetvideo.net/vod/1122')).rejects.toThrow(
      BadGatewayException
    );
  });
});
