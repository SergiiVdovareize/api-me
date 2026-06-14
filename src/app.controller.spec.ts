import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { HttpException, HttpStatus, StreamableFile } from '@nestjs/common';
import { Readable } from 'stream';

describe('AppController', () => {
  let appController: AppController;
  let appService: any;
  let analyticsService: any;

  beforeEach(async () => {
    appService = {
      getHello: jest.fn().mockReturnValue('Hello mr. Bob!'),
    };
    analyticsService = {
      trackEvent: jest.fn(),
    };

    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        { provide: AppService, useValue: appService },
        { provide: AnalyticsService, useValue: analyticsService },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
    jest.clearAllMocks();
  });

  describe('root', () => {
    it('should return "Hello mr. Bob!"', async () => {
      expect(await appController.getHello()).toBe('Hello mr. Bob!');
    });
  });

  describe('test', () => {
    it('should return success: true', async () => {
      const result = await appController.test('xyz');
      expect(result).toEqual({ success: true });
    });
  });

  describe('download', () => {
    it('should throw BadRequest exception if url parameter is missing', async () => {
      await expect(appController.download(undefined as any)).rejects.toThrow(HttpException);
      await expect(appController.download('')).rejects.toThrow('Missing url parameter');
    });

    it('should throw exception if fetch is not ok', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: HttpStatus.NOT_FOUND,
        statusText: 'Not Found',
      } as any);

      await expect(appController.download('https://example.com/media.mp4')).rejects.toThrow(
        new HttpException('Failed to fetch media: Not Found', HttpStatus.NOT_FOUND)
      );
    });

    it('should throw exception if response has no body', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        body: null,
      } as any);

      await expect(appController.download('https://example.com/media.mp4')).rejects.toThrow(
        new HttpException(
          'No response body received from media server',
          HttpStatus.INTERNAL_SERVER_ERROR
        )
      );
    });

    it('should return StreamableFile with correct content type and filename when content type is mapped', async () => {
      jest.spyOn(Readable, 'fromWeb').mockReturnValue({} as any);

      const headers = new Map<string, string>();
      headers.set('content-length', '500');
      headers.set('content-type', 'video/mp4');

      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        body: {},
        headers: {
          get: (name: string) => headers.get(name),
        },
      } as any);

      const result = await appController.download(
        'https://example.com/media.mp4',
        'custom-name.mp4'
      );
      expect(result).toBeInstanceOf(StreamableFile);
      expect(result.options.type).toBe('video/mp4');
      expect(result.options.disposition).toContain('filename="custom-name.mp4"');
      expect(result.options.length).toBe(500);
    });

    it('should fallback to audio or image base type extensions if not found in map', async () => {
      jest.spyOn(Readable, 'fromWeb').mockReturnValue({} as any);

      const headers = new Map<string, string>();
      headers.set('content-type', 'audio/unknown-type');

      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        body: {},
        headers: {
          get: (name: string) => headers.get(name),
        },
      } as any);

      const result = await appController.download('https://example.com/audio-file');
      expect(result.options.type).toBe('audio/unknown-type');
      expect(result.options.disposition).toContain('audio_');
      expect(result.options.disposition).toContain('.mp3'); // default for audio
    });

    it('should fallback to URL pathname extension if content type not in map and URL has extension', async () => {
      jest.spyOn(Readable, 'fromWeb').mockReturnValue({} as any);

      const headers = new Map<string, string>();
      headers.set('content-type', 'application/octet-stream');

      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        body: {},
        headers: {
          get: (name: string) => headers.get(name),
        },
      } as any);

      const result = await appController.download('https://example.com/path/to/animation.gif');
      expect(result.options.disposition).toContain('.gif');
    });

    it('should throw internal server error if general exception is caught', async () => {
      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Fetch network failure'));

      await expect(appController.download('https://example.com/media.mp4')).rejects.toThrow(
        new HttpException('Failed to download resource', HttpStatus.INTERNAL_SERVER_ERROR)
      );
    });
  });
});
