import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';
import { RedisReader } from 'src/common/helpers/redisReader';
import { SAVERAPI_CONSTANTS } from './saverapi.constants';
import { SaverapiDownloader } from './saverapi.downloader';
import { SaverapiError } from './saverapi.error';

jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
}));

describe('SaverapiDownloader', () => {
  let downloader: SaverapiDownloader;
  let configService: { get: jest.Mock };
  let redisReader: { read: jest.Mock; write: jest.Mock };
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'ENABLE_SAVERAPI') return 'true';
        if (key === 'SAVERAPI_KEY') return 'test-saverapi-key';
        if (key === 'SAVERAPI_ENDPOINT') return SAVERAPI_CONSTANTS.DEFAULT_ENDPOINT;
        return undefined;
      }),
    };

    redisReader = {
      read: jest.fn().mockResolvedValue(null),
      write: jest.fn().mockResolvedValue('OK'),
    };

    downloader = new SaverapiDownloader(
      configService as unknown as ConfigService,
      redisReader as unknown as RedisReader
    );

    fetchSpy = jest.spyOn(global, 'fetch');
    jest.clearAllMocks();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('should resolve and cache a valid video URL', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': '200' }),
      text: async () =>
        JSON.stringify({
          error: false,
          hosting: 'instagram',
          type: 'video',
          download_url: 'https://cdn.example.com/video.mp4',
          thumb: 'https://cdn.example.com/thumb.jpg',
          caption: 'Test reel',
        }),
    } as Response);

    const result = await downloader.steal('https://www.instagram.com/reel/abc123/');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
    expect(String(calledUrl)).toContain('url=https%3A%2F%2Fwww.instagram.com%2Freel%2Fabc123%2F');
    expect(calledInit.headers['x-api-key']).toBe('test-saverapi-key');
    expect(calledInit.redirect).toBe('error');

    expect(result).toEqual({
      success: true,
      platform: 'instagram',
      title: 'Test reel',
      description: null,
      thumbnail: 'https://cdn.example.com/thumb.jpg',
      duration: null,
      media: [
        {
          type: 'video',
          url: 'https://cdn.example.com/video.mp4',
          quality: null,
          format: 'mp4',
          sizeMB: null,
        },
      ],
    });
    expect(redisReader.write).toHaveBeenCalledWith(
      expect.stringContaining(SAVERAPI_CONSTANTS.CACHE_REDIS_PREFIX),
      expect.any(String),
      SAVERAPI_CONSTANTS.CACHE_TTL_SECONDS
    );
  });

  it('should return cached result without calling SaverAPI', async () => {
    const cachedResult = {
      success: true,
      platform: 'instagram',
      title: 'Cached',
      description: null,
      thumbnail: null,
      duration: null,
      media: [{ type: 'video', url: 'https://cdn.example.com/cached.mp4' }],
    };
    redisReader.read
      .mockResolvedValueOnce(null) // circuit breaker
      .mockResolvedValueOnce(JSON.stringify(cachedResult)); // cache hit

    const result = await downloader.steal('https://www.instagram.com/reel/abc123/');

    expect(result).toEqual(cachedResult);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should skip upstream call when circuit breaker is open', async () => {
    redisReader.read.mockResolvedValueOnce('1');

    await expect(downloader.steal('https://www.instagram.com/reel/abc123/')).rejects.toMatchObject({
      code: 'CIRCUIT_OPEN',
      shouldFallbackToNext: true,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should open circuit breaker on HTTP 402 quota exhaustion', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 402,
      headers: new Headers(),
      text: async () => JSON.stringify({ error: true, message: 'Quota exhausted' }),
    } as Response);

    await expect(downloader.steal('https://www.instagram.com/reel/abc123/')).rejects.toMatchObject({
      code: 'PROVIDER_QUOTA_EXHAUSTED',
      shouldFallbackToNext: true,
    });

    expect(redisReader.write).toHaveBeenCalledWith(
      SAVERAPI_CONSTANTS.CIRCUIT_BREAKER_REDIS_KEY,
      '1',
      SAVERAPI_CONSTANTS.CIRCUIT_BREAKER_TTL_SECONDS
    );
  });

  it('should send Sentry alert on HTTP 401/403 and allow fallback', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers(),
      text: async () => JSON.stringify({ error: true, message: 'Unauthorized' }),
    } as Response);

    await expect(downloader.steal('https://www.instagram.com/reel/abc123/')).rejects.toMatchObject({
      code: 'PROVIDER_AUTH_FAILED',
      shouldFallbackToNext: true,
    });
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
  });

  it('should stop fallback chain on private content (HTTP 400)', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 400,
      headers: new Headers(),
      text: async () => JSON.stringify({ error: true, message: 'This video is private' }),
    } as Response);

    await expect(downloader.steal('https://www.instagram.com/reel/abc123/')).rejects.toMatchObject({
      code: 'PRIVATE_CONTENT',
      shouldFallbackToNext: false,
    });
  });

  it('should reject unsafe SSRF download_url returned by upstream', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () =>
        JSON.stringify({
          error: false,
          hosting: 'instagram',
          type: 'video',
          download_url: 'https://127.0.0.1/secret.mp4',
        }),
    } as Response);

    await expect(downloader.steal('https://www.instagram.com/reel/abc123/')).rejects.toBeInstanceOf(
      SaverapiError
    );
  });

  it('should reject unsupported source domain without calling SaverAPI', async () => {
    await expect(downloader.steal('https://evil.example.org/video/1')).rejects.toMatchObject({
      code: 'UNSUPPORTED_URL',
      shouldFallbackToNext: false,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
