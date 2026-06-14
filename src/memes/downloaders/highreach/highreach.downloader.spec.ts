import { Test, TestingModule } from '@nestjs/testing';
import { HighreachDownloader } from './highreach.downloader';
import { AnalyticsService } from 'src/analytics/analytics.service';

describe('HighreachDownloader', () => {
  let downloader: HighreachDownloader;
  let analyticsService: AnalyticsService;
  let originalFetch: typeof global.fetch;

  beforeEach(async () => {
    originalFetch = global.fetch;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HighreachDownloader,
        {
          provide: AnalyticsService,
          useValue: {
            trackEvent: jest.fn(),
          },
        },
      ],
    }).compile();

    downloader = module.get<HighreachDownloader>(HighreachDownloader);
    analyticsService = module.get<AnalyticsService>(AnalyticsService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should query Highreach API and return DownloadResult on success', async () => {
    const mockRawResponse = {
      title: 'Highreach video',
      url: 'https://highreach-cdn.com/file.mp4',
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(mockRawResponse),
    });

    const result = await downloader.steal('https://x.com/status/123');

    expect(result.success).toBe(true);
    expect(result.platform).toBe('twitter');
    expect(result.title).toBe('Highreach video');
    expect(result.media).toHaveLength(1);
    expect(result.media[0].url).toBe('https://highreach-cdn.com/file.mp4');
    expect(analyticsService.trackEvent).toHaveBeenCalled();
  });

  it('should throw error when API returns empty response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(null),
    });

    await expect(downloader.steal('https://x.com/status/123')).rejects.toThrow(
      'Highreach returned invalid or empty response'
    );
  });

  it('should throw error when API returns no media results', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ formats: [] }),
    });

    await expect(downloader.steal('https://x.com/status/123')).rejects.toThrow(
      'Highreach returned no formats or invalid response'
    );
  });

  it('should throw error when HTTP request fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
    });

    await expect(downloader.steal('https://x.com/status/123')).rejects.toThrow(
      'Highreach analyze failed with status: 400'
    );
  });
});
