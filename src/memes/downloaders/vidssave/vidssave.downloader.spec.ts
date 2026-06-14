import { Test, TestingModule } from '@nestjs/testing';
import { VidssaveDownloader } from './vidssave.downloader';
import { AnalyticsService } from 'src/analytics/analytics.service';

describe('VidssaveDownloader', () => {
  let downloader: VidssaveDownloader;
  let analyticsService: AnalyticsService;
  let originalFetch: typeof global.fetch;

  beforeEach(async () => {
    originalFetch = global.fetch;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VidssaveDownloader,
        {
          provide: AnalyticsService,
          useValue: {
            trackEvent: jest.fn(),
          },
        },
      ],
    }).compile();

    downloader = module.get<VidssaveDownloader>(VidssaveDownloader);
    analyticsService = module.get<AnalyticsService>(AnalyticsService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should query vidssave flow and return DownloadResult on success', async () => {
    const mockLandingHtml = `<html><body><script src="/_next/static/chunks/pages/(site)/layout-abc123xyz.js"></script></body></html>`;
    const mockJsContent = `const config = { auth=test_auth_token_value_456 };`;
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

    // Sequential mock fetch calls
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue(mockLandingHtml),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue(mockJsContent),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(mockParseResponse),
      });

    const result = await downloader.steal('https://youtube.com/watch?v=123');

    expect(result.success).toBe(true);
    expect(result.platform).toBe('youtube');
    expect(result.title).toBe('Vidssave Meme');
    expect(result.media).toHaveLength(1);
    expect(result.media[0].url).toBe('https://vidssave-cdn.com/play.mp4');
    expect(analyticsService.trackEvent).toHaveBeenCalled();
  });

  it('should throw an error when landing page fetch fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      statusText: 'Service Unavailable',
    });

    await expect(downloader.steal('https://youtube.com/watch?v=123')).rejects.toThrow(
      'Failed to fetch vidssave landing page: Service Unavailable'
    );
  });

  it('should throw an error when layout script chunk is missing', async () => {
    const mockLandingHtml = `<html><body><div>No chunks here</div></body></html>`;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue(mockLandingHtml),
    });

    await expect(downloader.steal('https://youtube.com/watch?v=123')).rejects.toThrow(
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

    await expect(downloader.steal('https://youtube.com/watch?v=123')).rejects.toThrow(
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

    await expect(downloader.steal('https://youtube.com/watch?v=123')).rejects.toThrow(
      'Could not find auth token in vidssave layout script'
    );
  });

  it('should throw an error when parse request fails', async () => {
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
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

    await expect(downloader.steal('https://youtube.com/watch?v=123')).rejects.toThrow(
      'Vidssave parse failed with status: 401'
    );
  });

  it('should throw an error when parsing returns unsuccessful response status', async () => {
    const mockLandingHtml = `<html><body><script src="/_next/static/chunks/pages/(site)/layout-abc123xyz.js"></script></body></html>`;
    const mockJsContent = `const config = { auth=test_auth_token_value_456 };`;
    const mockParseResponse = {
      status: 0,
      message: 'Auth expired',
    };

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue(mockLandingHtml),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: jest.fn().mockResolvedValue(mockJsContent),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue(mockParseResponse),
      });

    await expect(downloader.steal('https://youtube.com/watch?v=123')).rejects.toThrow(
      'Auth expired'
    );
  });
});
