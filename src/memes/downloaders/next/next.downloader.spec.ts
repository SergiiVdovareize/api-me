import { Test, TestingModule } from '@nestjs/testing';
import { NextDownloader } from './next.downloader';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { HttpException, StreamableFile } from '@nestjs/common';

describe('NextDownloader', () => {
  let downloader: NextDownloader;
  let analyticsService: AnalyticsService;
  let originalFetch: typeof global.fetch;

  beforeEach(async () => {
    originalFetch = global.fetch;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NextDownloader,
        {
          provide: AnalyticsService,
          useValue: {
            trackEvent: jest.fn(),
          },
        },
      ],
    }).compile();

    downloader = module.get<NextDownloader>(NextDownloader);
    analyticsService = module.get<AnalyticsService>(AnalyticsService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('steal', () => {
    it('should query NextDownloader analyze API and return DownloadResult on success', async () => {
      const mockRawResponse = {
        title: 'Meme Video',
        formats: [{ ext: 'mp4', quality: '720p' }],
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockRawResponse),
      });

      const result = await downloader.steal('https://youtube.com/watch?v=123');

      expect(result.success).toBe(true);
      expect(result.title).toBe('Meme Video');
      expect(result.media).toHaveLength(1);
      expect(analyticsService.trackEvent).toHaveBeenCalled();
    });

    it('should throw an error when analysis API returns no formats', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ title: 'Video', formats: [] }),
      });

      await expect(downloader.steal('https://youtube.com/watch?v=123')).rejects.toThrow(
        'NextDownloader returned no formats or invalid response'
      );
    });

    it('should throw an error when analysis request fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      await expect(downloader.steal('https://youtube.com/watch?v=123')).rejects.toThrow(
        'NextDownloader analyze failed with status: 500'
      );
    });
  });

  describe('download', () => {
    it('should return a StreamableFile on a successful proxy fetch', async () => {
      const mockBody = new ReadableStream({
        start(controller) {
          controller.close();
        },
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        body: mockBody,
        headers: {
          get: (header: string) => {
            if (header === 'content-length') return '1000';
            if (header === 'content-type') return 'video/mp4';
            return null;
          },
        },
      });

      const params = {
        url: 'https://youtube.com/watch?v=123',
        type: 'video',
        quality: '720p',
        ext: 'mp4',
        title: 'TestVideo',
        duration: '10',
      };

      const result = await downloader.download(params);

      expect(result).toBeInstanceOf(StreamableFile);
    });

    it('should throw a NestJS HttpException when download fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const params = {
        url: 'https://youtube.com/watch?v=123',
        type: 'video',
        quality: '720p',
        ext: 'mp4',
        title: 'TestVideo',
        duration: '10',
      };

      await expect(downloader.download(params)).rejects.toThrow(HttpException);
    });
  });
});
