import { Test, TestingModule } from '@nestjs/testing';
import { MediasnapDownloader } from './mediasnap.downloader';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { downloadMedia } from 'mediasnap';

jest.mock('mediasnap', () => ({
  downloadMedia: jest.fn(),
}));

describe('MediasnapDownloader', () => {
  let downloader: MediasnapDownloader;
  let analyticsService: AnalyticsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediasnapDownloader,
        {
          provide: AnalyticsService,
          useValue: {
            trackEvent: jest.fn(),
          },
        },
      ],
    }).compile();

    downloader = module.get<MediasnapDownloader>(MediasnapDownloader);
    analyticsService = module.get<AnalyticsService>(AnalyticsService);
  });

  it('should steal a meme using downloadMedia and track analytic event', async () => {
    const mockRawResult = {
      success: true,
      platform: 'facebook',
      media: [{ url: 'https://cdn.com/fb.mp4', type: 'video' }],
    };
    (downloadMedia as jest.Mock).mockResolvedValue(mockRawResult);

    const result = await downloader.steal('https://facebook.com/watch/123');

    expect(result.success).toBe(true);
    expect(result.platform).toBe('facebook');
    expect(result.media[0].url).toBe('https://cdn.com/fb.mp4');
    expect(analyticsService.trackEvent).toHaveBeenCalled();
  });

  it('should propagate downloadMedia errors', async () => {
    (downloadMedia as jest.Mock).mockRejectedValue(new Error('mediasnap library error'));

    await expect(downloader.steal('https://facebook.com/watch/123')).rejects.toThrow(
      'mediasnap library error'
    );
  });
});
