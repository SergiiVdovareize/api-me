import { Test, TestingModule } from '@nestjs/testing';
import { MemesService } from './memes.service';
import {
  SnapsaveDownloader,
  MediasnapDownloader,
  NextDownloader,
  HighreachDownloader,
  VidssaveDownloader,
} from './downloaders';
import { sortMediaByQuality } from './utils/quality-sort';
import * as Sentry from '@sentry/nestjs';

jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
  flush: jest.fn().mockResolvedValue(true),
}));

describe('MemesService', () => {
  let service: MemesService;
  let snapsave: any;
  let mediasnap: any;
  let next: any;
  let highreach: any;
  let vidssave: any;

  beforeEach(async () => {
    snapsave = { steal: jest.fn() };
    mediasnap = { steal: jest.fn() };
    next = { download: jest.fn(), steal: jest.fn() };
    highreach = { steal: jest.fn() };
    vidssave = { steal: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemesService,
        { provide: SnapsaveDownloader, useValue: snapsave },
        { provide: MediasnapDownloader, useValue: mediasnap },
        { provide: NextDownloader, useValue: next },
        { provide: HighreachDownloader, useValue: highreach },
        { provide: VidssaveDownloader, useValue: vidssave },
      ],
    }).compile();

    service = module.get<MemesService>(MemesService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('downloadFromNextdownloader', () => {
    it('should forward parameters to nextDownloader.download', async () => {
      const params = { url: 'u', type: 'v', quality: 'q', ext: 'e', title: 't', duration: 'd' };
      next.download.mockResolvedValue('file-stream');

      const result = await service.downloadFromNextdownloader(params);
      expect(next.download).toHaveBeenCalledWith(params);
      expect(result).toBe('file-stream');
    });
  });

  describe('stealMeme', () => {
    it('should return successfully if one downloader returns success', async () => {
      const mockResult = {
        success: true,
        media: [
          { url: 'https://ok-url.com', quality: '720p' },
          { url: 'invalid-url', quality: '1080p' },
          { url: '//relative-url.com', quality: '360p' },
        ],
      };

      // Mock one success, others fail
      mediasnap.steal.mockResolvedValue(mockResult);
      snapsave.steal.mockRejectedValue(new Error('fail'));
      highreach.steal.mockRejectedValue(new Error('fail'));
      vidssave.steal.mockRejectedValue(new Error('fail'));

      const result = await service.stealMeme('https://instagram.com/p/123');

      expect(result.success).toBe(true);
      // 'invalid-url' is filtered out because it doesn't start with http://, https://, or //
      expect(result.media).toEqual([
        { url: 'https://ok-url.com', quality: '720p' },
        { url: '//relative-url.com', quality: '360p' },
      ]);
    });

    it('should retry on subsequent attempts and succeed eventually', async () => {
      // First attempt: all fail
      mediasnap.steal.mockRejectedValue(new Error('fail'));
      snapsave.steal.mockRejectedValue(new Error('fail'));
      highreach.steal.mockRejectedValue(new Error('fail'));
      vidssave.steal.mockRejectedValue(new Error('fail'));

      // We make the second attempt succeed by changing mock resolved values inside the execution block
      let count = 0;
      mediasnap.steal.mockImplementation(async () => {
        count++;
        if (count === 1) throw new Error('fail');
        return { success: true, media: [{ url: 'https://meme.jpg', quality: '720p' }] };
      });

      const result = await service.stealMeme('url');
      expect(result.success).toBe(true);
      expect(result.media).toHaveLength(1);
    });

    it('should capture message in Sentry and return failure if all attempts fail', async () => {
      mediasnap.steal.mockRejectedValue(new Error('mediasnap failed'));
      snapsave.steal.mockRejectedValue(new Error('snapsave failed'));
      highreach.steal.mockRejectedValue(new Error('highreach failed'));
      vidssave.steal.mockRejectedValue(new Error('vidssave failed'));

      const result = await service.stealMeme('url-to-steal');

      expect(result.success).toBe(false);
      expect(result.error).toBe('could not download the media');
      expect(Sentry.captureMessage).toHaveBeenCalled();
      expect(Sentry.flush).toHaveBeenCalled();
    });
  });

  describe('sortMediaByQuality', () => {
    it('should sort media items by quality descending with best quality first', () => {
      const media = [
        { url: 'url1', quality: '360p' },
        { url: 'url2', quality: '1080P' },
        { url: 'url3', quality: '720p' },
        { url: 'url4', quality: null },
        { url: 'url5', quality: '480' },
      ];

      const sorted = sortMediaByQuality(media);

      expect(sorted).toEqual([
        { url: 'url2', quality: '1080P' },
        { url: 'url3', quality: '720p' },
        { url: 'url5', quality: '480' },
        { url: 'url1', quality: '360p' },
        { url: 'url4', quality: null },
      ]);
    });

    it('should handle qualities without numeric values or empty qualities gracefully', () => {
      const media = [
        { url: 'url1', quality: 'low' },
        { url: 'url2', quality: 'high-128kbps' },
        { url: 'url3', quality: 'mid-256kbps' },
        { url: 'url4', quality: undefined },
      ];

      const sorted = sortMediaByQuality(media as any);

      expect(sorted).toEqual([
        { url: 'url3', quality: 'mid-256kbps' },
        { url: 'url2', quality: 'high-128kbps' },
        { url: 'url1', quality: 'low' },
        { url: 'url4', quality: undefined },
      ]);
    });
  });
});
