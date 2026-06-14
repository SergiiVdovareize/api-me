import { Test, TestingModule } from '@nestjs/testing';
import { VidssaveDownloader } from './vidssave.downloader';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { VidssaveTokenParser } from './vidssave.token-parser';
import { BlobService } from 'src/blob/blob.service';

describe('VidssaveDownloader', () => {
  let downloader: VidssaveDownloader;
  let tokenParser: jest.Mocked<VidssaveTokenParser>;
  let blobService: jest.Mocked<BlobService>;
  let originalFetch: typeof global.fetch;

  const mockParseResponse = {
    status: 1,
    data: {
      title: 'Vidssave Meme',
      media: [
        {
          resources: [
            {
              type: 'video',
              download_url: 'https://vidssave-cdn.com/play.mp4',
              quality: '720p',
              format: 'mp4',
            },
          ],
        },
      ],
    },
  };

  beforeEach(async () => {
    originalFetch = global.fetch;

    const mockTokenParser = {
      parseToken: jest.fn(),
    };

    const mockBlobService = {
      read: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VidssaveDownloader,
        {
          provide: AnalyticsService,
          useValue: {
            trackEvent: jest.fn(),
          },
        },
        {
          provide: VidssaveTokenParser,
          useValue: mockTokenParser,
        },
        {
          provide: BlobService,
          useValue: mockBlobService,
        },
      ],
    }).compile();

    downloader = module.get<VidssaveDownloader>(VidssaveDownloader);
    tokenParser = module.get(VidssaveTokenParser);
    blobService = module.get(BlobService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should successfully steal using cached token (cache hit success)', async () => {
    blobService.read.mockResolvedValue({ token: 'cached_token_abc' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(mockParseResponse),
    });

    const result = await downloader.steal('https://youtube.com/watch?v=123');

    expect(result.success).toBe(true);
    expect(result.title).toBe('Vidssave Meme');
    expect(blobService.read).toHaveBeenCalledWith('vidssave-auth-token.json');
    expect(tokenParser.parseToken).not.toHaveBeenCalled();
    expect(blobService.create).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Verify correct authorization token used
    const fetchArgs = (global.fetch as jest.Mock).mock.calls[0];
    expect(fetchArgs[0]).toBe('https://api.vidssave.com/api/contentsite_api/media/parse');
    expect(fetchArgs[1].body).toContain('auth=cached_token_abc');
  });

  it('should successfully parse new token, save to cache and steal on cache miss', async () => {
    blobService.read.mockResolvedValue(null);
    tokenParser.parseToken.mockResolvedValue('parsed_token_xyz');
    blobService.remove.mockResolvedValue({});
    blobService.create.mockResolvedValue({});
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(mockParseResponse),
    });

    const result = await downloader.steal('https://youtube.com/watch?v=123');

    expect(result.success).toBe(true);
    expect(tokenParser.parseToken).toHaveBeenCalledTimes(1);
    expect(blobService.remove).toHaveBeenCalledWith('vidssave-auth-token.json');
    expect(blobService.create).toHaveBeenCalledWith('vidssave-auth-token.json', {
      token: 'parsed_token_xyz',
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const fetchArgs = (global.fetch as jest.Mock).mock.calls[0];
    expect(fetchArgs[1].body).toContain('auth=parsed_token_xyz');
  });

  it('should parse new token if reading cache throws an error', async () => {
    blobService.read.mockRejectedValue(new Error('Vercel Blob connection issue'));
    tokenParser.parseToken.mockResolvedValue('parsed_token_recovery');
    blobService.remove.mockResolvedValue({});
    blobService.create.mockResolvedValue({});
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(mockParseResponse),
    });

    const result = await downloader.steal('https://youtube.com/watch?v=123');

    expect(result.success).toBe(true);
    expect(tokenParser.parseToken).toHaveBeenCalledTimes(1);
    expect(blobService.create).toHaveBeenCalledWith('vidssave-auth-token.json', {
      token: 'parsed_token_recovery',
    });
  });

  it('should catch cached token invalid, remove cached token, parse new token, save it and retry successfully', async () => {
    blobService.read.mockResolvedValue({ token: 'invalid_cached_token' });
    tokenParser.parseToken.mockResolvedValue('fresh_valid_token');
    blobService.remove.mockResolvedValue({});
    blobService.create.mockResolvedValue({});

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ status: 0, message: 'Invalid token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(mockParseResponse),
      });

    const result = await downloader.steal('https://youtube.com/watch?v=123');

    expect(result.success).toBe(true);
    expect(blobService.remove).toHaveBeenCalledWith('vidssave-auth-token.json');
    expect(tokenParser.parseToken).toHaveBeenCalledTimes(1);
    expect(blobService.create).toHaveBeenCalledWith('vidssave-auth-token.json', {
      token: 'fresh_valid_token',
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);

    const firstCall = (global.fetch as jest.Mock).mock.calls[0];
    const secondCall = (global.fetch as jest.Mock).mock.calls[1];
    expect(firstCall[1].body).toContain('auth=invalid_cached_token');
    expect(secondCall[1].body).toContain('auth=fresh_valid_token');
  });

  it('should throw error and NOT retry if the token was NOT from cache', async () => {
    blobService.read.mockResolvedValue(null);
    tokenParser.parseToken.mockResolvedValue('new_token_but_invalid');
    blobService.remove.mockResolvedValue({});
    blobService.create.mockResolvedValue({});
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ status: 0, message: 'Parse failed' }),
    });

    await expect(downloader.steal('https://youtube.com/watch?v=123')).rejects.toThrow(
      'Parse failed'
    );

    // No retry should occur
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(tokenParser.parseToken).toHaveBeenCalledTimes(1);
  });

  it('should throw error if retry fails with the newly parsed token', async () => {
    blobService.read.mockResolvedValue({ token: 'invalid_cached_token' });
    tokenParser.parseToken.mockResolvedValue('new_token_also_invalid');
    blobService.remove.mockResolvedValue({});
    blobService.create.mockResolvedValue({});

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ status: 0, message: 'Invalid cached' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ status: 0, message: 'Invalid new' }),
      });

    await expect(downloader.steal('https://youtube.com/watch?v=123')).rejects.toThrow(
      'Invalid new'
    );

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(blobService.remove).toHaveBeenCalledTimes(1);
  });

  it('should throw error if the parse request HTTP status is not ok', async () => {
    blobService.read.mockResolvedValue({ token: 'token' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    await expect(downloader.steal('https://youtube.com/watch?v=123')).rejects.toThrow(
      'Vidssave parse failed with status: 500'
    );
  });

  it('should throw error if parse response contains empty media list', async () => {
    blobService.read.mockResolvedValue({ token: 'token' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        status: 1,
        data: {
          title: 'Empty Media',
          media: [],
        },
      }),
    });

    await expect(downloader.steal('https://youtube.com/watch?v=123')).rejects.toThrow(
      'Vidssave returned no formats/resources or invalid response structure'
    );
  });

  it('should throw error with default message if parse response contains unsuccessful status but no message', async () => {
    blobService.read.mockResolvedValue({ token: 'token' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        status: 0,
      }),
    });

    await expect(downloader.steal('https://youtube.com/watch?v=123')).rejects.toThrow(
      'Vidssave parse response status is unsuccessful'
    );
  });

  it('should continue and steal even if saving newly parsed token to cache fails', async () => {
    blobService.read.mockResolvedValue(null);
    tokenParser.parseToken.mockResolvedValue('parsed_token_xyz');
    blobService.create.mockRejectedValue(new Error('Vercel Blob put error'));
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(mockParseResponse),
    });

    const result = await downloader.steal('https://youtube.com/watch?v=123');
    expect(result.success).toBe(true);
  });

  it('should retry and steal even if removing cached token or caching new token fails during retry', async () => {
    blobService.read.mockResolvedValue({ token: 'invalid_cached_token' });
    tokenParser.parseToken.mockResolvedValue('fresh_valid_token');
    blobService.remove.mockRejectedValue(new Error('Vercel Blob del error'));
    blobService.create.mockRejectedValue(new Error('Vercel Blob put error'));

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ status: 0, message: 'Invalid token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(mockParseResponse),
      });

    const result = await downloader.steal('https://youtube.com/watch?v=123');
    expect(result.success).toBe(true);
  });
});
