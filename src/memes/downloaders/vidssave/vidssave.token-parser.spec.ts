import { Test, TestingModule } from '@nestjs/testing';
import { VidssaveTokenParser } from './vidssave.token-parser';

describe('VidssaveTokenParser', () => {
  let parser: VidssaveTokenParser;
  let originalFetch: typeof global.fetch;

  beforeEach(async () => {
    originalFetch = global.fetch;
    const module: TestingModule = await Test.createTestingModule({
      providers: [VidssaveTokenParser],
    }).compile();

    parser = module.get<VidssaveTokenParser>(VidssaveTokenParser);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should successfully parse auth token from layout script', async () => {
    const mockLandingHtml = `<html><body><script src="/_next/static/chunks/pages/(site)/layout-abc123xyz.js"></script></body></html>`;
    const mockJsContent = `const config = { auth=test_auth_token_value_456 };`;

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue(mockLandingHtml),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue(mockJsContent),
      });

    const token = await parser.parseToken();
    expect(token).toBe('test_auth_token_value_456');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      'https://vidssave.com/youtube-video-downloader-6fu'
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      'https://vidssave.com/_next/static/chunks/pages/(site)/layout-abc123xyz.js'
    );
  });

  it('should successfully parse auth token when layout script has absolute URL', async () => {
    const mockLandingHtml = `<html><body><script src="https://vidssave.com/abc/(site)/layout-abc123xyz.js"></script></body></html>`;
    const mockJsContent = `const config = { auth=test_auth_token_value_456 };`;

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue(mockLandingHtml),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue(mockJsContent),
      });

    const token = await parser.parseToken();
    expect(token).toBe('test_auth_token_value_456');
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      'https://vidssave.com/abc/(site)/layout-abc123xyz.js'
    );
  });

  it('should successfully parse auth token when layout script is relative without leading slash', async () => {
    const mockLandingHtml = `<html><body><script src="abc/(site)/layout-abc123xyz.js"></script></body></html>`;
    const mockJsContent = `const config = { auth=test_auth_token_value_456 };`;

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue(mockLandingHtml),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue(mockJsContent),
      });

    const token = await parser.parseToken();
    expect(token).toBe('test_auth_token_value_456');
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      'https://vidssave.com/abc/(site)/layout-abc123xyz.js'
    );
  });

  it('should throw an error when landing page fetch fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      statusText: 'Service Unavailable',
    });

    await expect(parser.parseToken()).rejects.toThrow(
      'Failed to fetch vidssave landing page: Service Unavailable'
    );
  });

  it('should throw an error when layout script chunk is missing', async () => {
    const mockLandingHtml = `<html><body><div>No chunks here</div></body></html>`;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue(mockLandingHtml),
    });

    await expect(parser.parseToken()).rejects.toThrow(
      'Could not find the vidssave layout script URL in landing page HTML'
    );
  });

  it('should throw an error when layout js fetch fails', async () => {
    const mockLandingHtml = `<html><body><script src="/_next/static/chunks/pages/(site)/layout-abc123xyz.js"></script></body></html>`;
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue(mockLandingHtml),
      })
      .mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Error',
      });

    await expect(parser.parseToken()).rejects.toThrow(
      'Failed to fetch vidssave layout script: Internal Error'
    );
  });

  it('should throw an error when auth token regex matching fails', async () => {
    const mockLandingHtml = `<html><body><script src="/_next/static/chunks/pages/(site)/layout-abc123xyz.js"></script></body></html>`;
    const mockJsContent = `const config = { no_auth: 1 };`;
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue(mockLandingHtml),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue(mockJsContent),
      });

    await expect(parser.parseToken()).rejects.toThrow(
      'Could not find auth token in vidssave layout script'
    );
  });
});
