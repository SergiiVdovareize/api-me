import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { RedisReader } from 'src/common/helpers/redisReader';
import { SaveanyvideoDownloader } from './saveanyvideo.downloader';
import { SAVEANYVIDEO_CONSTANTS } from './saveanyvideo.constants';

describe('SaveanyvideoDownloader', () => {
  let downloader: SaveanyvideoDownloader;
  let analyticsService: { trackEvent: jest.Mock };
  let redisMock: { incr: jest.Mock; expire: jest.Mock };
  let configMock: { get: jest.Mock };
  const originalFetch = global.fetch;

  const validToken = 'a'.repeat(48);
  const validJobId = 'b'.repeat(64);
  const validUrl = 'https://www.instagram.com/reels/Dfs6A1mhZzU/';

  beforeEach(async () => {
    analyticsService = { trackEvent: jest.fn() };
    redisMock = {
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
    };
    configMock = {
      get: jest.fn().mockReturnValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SaveanyvideoDownloader,
        { provide: AnalyticsService, useValue: analyticsService },
        { provide: RedisReader, useValue: { redis: redisMock } },
        { provide: ConfigService, useValue: configMock },
      ],
    }).compile();

    downloader = module.get<SaveanyvideoDownloader>(SaveanyvideoDownloader);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function mockHeaders(cookie?: string): Headers {
    return {
      getSetCookie: cookie ? () => [cookie] : () => [],
      get: (name: string) => (name.toLowerCase() === 'set-cookie' ? cookie || null : null),
    } as unknown as Headers;
  }

  it('should execute token -> submit -> status ready and return DownloadResult', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: mockHeaders('PHPSESSID=sess123; path=/; HttpOnly'),
        json: async () => ({ token: validToken }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: validJobId, status: 'working' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'ready',
          size: 1048576,
          title: 'Test Reel',
          kind: 'video',
          count: 1,
        }),
      });

    global.fetch = fetchMock as any;

    const result = await downloader.steal(validUrl);

    expect(result.success).toBe(true);
    expect(result.platform).toBe('instagram');
    expect(result.title).toBe('Test Reel');
    expect(result.media[0].url).toBe(
      `${SAVEANYVIDEO_CONSTANTS.DEFAULT_API_BASE}?action=download&id=${validJobId}`
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][1].headers.cookie).toBe('PHPSESSID=sess123');
    expect(redisMock.incr).toHaveBeenCalledWith(SAVEANYVIDEO_CONSTANTS.RATE_LIMIT_REDIS_KEY);
    expect(redisMock.expire).toHaveBeenCalledWith(
      SAVEANYVIDEO_CONSTANTS.RATE_LIMIT_REDIS_KEY,
      SAVEANYVIDEO_CONSTANTS.RATE_LIMIT_WINDOW_SECONDS
    );
  });

  it('should reject disallowed domains like instagram.com.attacker.example', async () => {
    await expect(
      downloader.steal('https://instagram.com.attacker.example/reel/123')
    ).rejects.toThrow('Unsupported domain');
  });

  it('should reject http, credentials, port, and oversized URLs', async () => {
    await expect(downloader.steal('http://instagram.com/reel/123')).rejects.toThrow(
      'Unsupported URL scheme'
    );
    await expect(downloader.steal('https://user:pass@instagram.com/reel/123')).rejects.toThrow(
      'Unsupported URL scheme'
    );
    await expect(downloader.steal('https://instagram.com:8443/reel/123')).rejects.toThrow(
      'Unsupported URL scheme'
    );
    await expect(downloader.steal(`https://instagram.com/${'a'.repeat(2050)}`)).rejects.toThrow(
      'Invalid or too long URL'
    );
  });

  it('should throw when SAVEANYVIDEO_ENABLED is false', async () => {
    configMock.get.mockImplementation((key: string) =>
      key === 'SAVEANYVIDEO_ENABLED' ? 'false' : undefined
    );

    await expect(downloader.steal(validUrl)).rejects.toThrow('disabled');
  });

  it('should throw when global hourly quota is exceeded', async () => {
    redisMock.incr.mockResolvedValue(SAVEANYVIDEO_CONSTANTS.GLOBAL_HOURLY_LIMIT + 1);

    await expect(downloader.steal(validUrl)).rejects.toThrow('quota exceeded');
  });

  it('should retry full exchange once when submit returns error: "session"', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: mockHeaders('PHPSESSID=old_sess; path=/'),
        json: async () => ({ token: validToken }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ error: 'session' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: mockHeaders('PHPSESSID=new_sess; path=/'),
        json: async () => ({ token: validToken }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: validJobId, status: 'working' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: 'ready', kind: 'video', size: 1024 }),
      });

    global.fetch = fetchMock as any;

    const result = await downloader.steal(validUrl);
    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[3][1].headers.cookie).toBe('PHPSESSID=new_sess');
  });

  it('should throw when PHPSESSID cookie is missing', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: mockHeaders(undefined),
      json: async () => ({ token: validToken }),
    }) as any;

    await expect(downloader.steal(validUrl)).rejects.toThrow('missing PHPSESSID');
  });

  it('should throw when status returns error like expired', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: mockHeaders('PHPSESSID=sess; path=/'),
        json: async () => ({ token: validToken }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: validJobId, status: 'working' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ error: 'expired' }),
      }) as any;

    await expect(downloader.steal(validUrl)).rejects.toThrow('status error: expired');
  });
});
