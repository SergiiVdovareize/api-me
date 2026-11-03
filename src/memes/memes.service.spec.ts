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

      const result = await service.stealMeme('https://tiktok.com/@user/video/123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('could not download the media');
      expect(Sentry.captureMessage).toHaveBeenCalled();
      expect(Sentry.flush).toHaveBeenCalled();
    });

    it('should NOT capture message in Sentry for synthetic test URLs like example.com', async () => {
      jest.clearAllMocks();
      mediasnap.steal.mockRejectedValue(new Error('mediasnap failed'));
      snapsave.steal.mockRejectedValue(new Error('snapsave failed'));
      highreach.steal.mockRejectedValue(new Error('highreach failed'));
      vidssave.steal.mockRejectedValue(new Error('vidssave failed'));

      const result = await service.stealMeme('https://example.com/invalid-meme-url-12345');

      expect(result.success).toBe(false);
      expect(result.error).toBe('could not download the media');
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it('should NOT capture message in Sentry for malformed or non-http URLs like "test"', async () => {
      jest.clearAllMocks();
      mediasnap.steal.mockRejectedValue(new Error('mediasnap failed'));
      snapsave.steal.mockRejectedValue(new Error('snapsave failed'));
      highreach.steal.mockRejectedValue(new Error('highreach failed'));
      vidssave.steal.mockRejectedValue(new Error('vidssave failed'));

      const result = await service.stealMeme('test');

      expect(result.success).toBe(false);
      expect(result.error).toBe('could not download the media');
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });
  });

  describe('isValidHttpUrl and isSyntheticTest', () => {
    it('isValidHttpUrl should return true only for valid http and https URLs', () => {
      expect(service.isValidHttpUrl('https://instagram.com/reel/123')).toBe(true);
      expect(service.isValidHttpUrl('http://example.com')).toBe(true);
      expect(service.isValidHttpUrl('test')).toBe(false);
      expect(service.isValidHttpUrl('ftp://example.com')).toBe(false);
      expect(service.isValidHttpUrl('')).toBe(false);
      expect(service.isValidHttpUrl(null as any)).toBe(false);
    });

    it('isSyntheticTest should return true for invalid or synthetic test URLs and false for real target URLs', () => {
      expect(service.isSyntheticTest('test')).toBe(true);
      expect(service.isSyntheticTest('https://example.com/something')).toBe(true);
      expect(service.isSyntheticTest('http://localhost:3000')).toBe(true);
      expect(service.isSyntheticTest('http://127.0.0.1:8080')).toBe(true);
      expect(service.isSyntheticTest('https://tiktok.com/invalid-meme-url-1')).toBe(true);
      expect(service.isSyntheticTest('https://www.instagram.com/reel/Cx123')).toBe(false);
      expect(service.isSyntheticTest('https://www.tiktok.com/@user/video/12345')).toBe(false);
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

  describe('isDirectVideoUrl', () => {
    it('should identify direct video extensions', () => {
      expect(service.isDirectVideoUrl('https://example.com/video.mp4')).toBe(true);
      expect(service.isDirectVideoUrl('https://example.com/clip.webm')).toBe(true);
      expect(service.isDirectVideoUrl('https://example.com/movie.mov')).toBe(true);
      expect(service.isDirectVideoUrl('https://example.com/image.jpg')).toBe(false);
      expect(service.isDirectVideoUrl('https://instagram.com/reel/C_abc123/')).toBe(false);
      expect(service.isDirectVideoUrl('https://tiktok.com/@user/video/123')).toBe(false);
      expect(service.isDirectVideoUrl('invalid-url')).toBe(false);
    });
  });

  describe('streamVideo and streamFromDirectVideoUrl', () => {
    it('should stream directly when url is a direct video file', async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(16));
          controller.close();
        },
      });

      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        body: mockStream,
        headers: new Headers({
          'content-type': 'video/mp4',
          'content-length': '16',
        }),
      } as any);

      const result = await service.streamVideo('https://example.com/clip.mp4', 'custom.mp4');
      expect(result).toBeDefined();
    });

    it('should extract social media URL via stealMeme and stream the resolved video', async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(32));
          controller.close();
        },
      });

      mediasnap.steal.mockResolvedValue({
        success: true,
        title: 'Hilarious Cat Reel',
        media: [
          { url: 'https://cdn.instagram.com/raw_video.mp4', quality: '1080p', type: 'video' },
        ],
      });

      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        body: mockStream,
        headers: new Headers({
          'content-type': 'video/mp4',
          'content-length': '32',
        }),
      } as any);

      const result = await service.streamVideo('https://instagram.com/reel/12345');
      expect(result).toBeDefined();
    });

    it('should reject when stealMeme returns only image items', async () => {
      mediasnap.steal.mockResolvedValue({
        success: true,
        title: 'Photo Post',
        media: [{ url: 'https://cdn.instagram.com/photo.jpg', type: 'image' }],
      });

      await expect(service.streamVideo('https://instagram.com/p/12345')).rejects.toThrow(
        'Only video content is supported. No video stream found for this URL.'
      );
    });

    it('should throw BAD_REQUEST when url is not a valid HTTP/HTTPS URL (e.g. "test")', async () => {
      await expect(service.streamVideo('test')).rejects.toThrow(
        'Invalid URL. Please provide a valid HTTP or HTTPS video URL.'
      );
    });

    it('should throw NOT_FOUND exception when stealMeme returns unsuccessful result', async () => {
      mediasnap.steal.mockResolvedValue({
        success: false,
        error: 'Video unavailable',
        media: [],
      });
      snapsave.steal.mockResolvedValue({ success: false, media: [] });
      highreach.steal.mockResolvedValue({ success: false, media: [] });
      vidssave.steal.mockResolvedValue({ success: false, media: [] });

      await expect(service.streamVideo('https://example.com/invalid-meme-url-999')).rejects.toThrow(
        'could not download the media'
      );
    });

    it('should throw exception when upstream fetch fails', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      } as any);

      await expect(service.streamVideo('https://example.com/forbidden.mp4')).rejects.toThrow(
        'Failed to fetch video from source: Forbidden'
      );
    });

    it('should throw BAD_REQUEST when upstream response is an image', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        body: new ReadableStream(),
        headers: new Headers({
          'content-type': 'image/jpeg',
        }),
      } as any);

      await expect(service.streamVideo('https://example.com/not_a_video.mp4')).rejects.toThrow(
        'Only video content is supported. Upstream returned an image.'
      );
    });

    it('should throw exception when upstream response body is missing', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        body: null,
        headers: new Headers({
          'content-type': 'video/mp4',
        }),
      } as any);

      await expect(service.streamVideo('https://example.com/empty.mp4')).rejects.toThrow(
        'No response body received from media server'
      );
    });
  });
});
