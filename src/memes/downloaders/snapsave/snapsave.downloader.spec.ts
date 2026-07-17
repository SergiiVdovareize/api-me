import { Test, TestingModule } from '@nestjs/testing';
import { SnapsaveDownloader } from './snapsave.downloader';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { snapsave } from 'snapsave-adapter';

jest.mock('snapsave-adapter', () => ({
  snapsave: jest.fn(),
}));

describe('SnapsaveDownloader', () => {
  let downloader: SnapsaveDownloader;
  let analyticsService: AnalyticsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SnapsaveDownloader,
        {
          provide: AnalyticsService,
          useValue: {
            trackEvent: jest.fn(),
          },
        },
      ],
    }).compile();

    downloader = module.get<SnapsaveDownloader>(SnapsaveDownloader);
    analyticsService = module.get<AnalyticsService>(AnalyticsService);
  });

  it('should steal a meme and log analytic event', async () => {
    const mockRawResult = {
      success: true,
      platform: 'instagram',
      media: [{ url: 'https://cdn.com/123.mp4', type: 'video' }],
    };
    (snapsave as jest.Mock).mockResolvedValue(mockRawResult);

    const result = await downloader.steal('https://instagram.com/p/123');

    expect(result.success).toBe(true);
    expect(result.platform).toBe('instagram');
    expect(result.media[0].url).toBe('https://cdn.com/123.mp4');
    expect(analyticsService.trackEvent).toHaveBeenCalled();
  });

  it('should propagate snapsave errors', async () => {
    (snapsave as jest.Mock).mockRejectedValue(new Error('snapsave API error'));

    await expect(downloader.steal('https://instagram.com/p/123')).rejects.toThrow(
      'snapsave API error'
    );
  });
});
