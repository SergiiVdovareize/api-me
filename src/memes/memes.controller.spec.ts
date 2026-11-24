import { Test, TestingModule } from '@nestjs/testing';
import { StreamableFile } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MemesController } from './memes.controller';
import { MemesService } from './memes.service';
import { OriginGuard } from './origin.guard';

describe('MemesController', () => {
  let controller: MemesController;
  let memesService: any;

  beforeEach(async () => {
    memesService = {
      streamVideo: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn().mockImplementation((key: string, defaultValue?: any) => {
        if (key === 'ALLOWED_ORIGIN') return 'https://snip.vdovareize.me/';
        if (key === 'HOST') return 'local';
        if (key === 'NODE_ENV') return 'development';
        return defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MemesController],
      providers: [
        { provide: MemesService, useValue: memesService },
        { provide: ConfigService, useValue: mockConfigService },
        OriginGuard,
      ],
    }).compile();

    controller = module.get<MemesController>(MemesController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('steal (GET /memes/:url)', () => {
    it('should immediately stream video via memesService.streamVideo', async () => {
      const mockStreamable = {} as StreamableFile;
      memesService.streamVideo.mockResolvedValue(mockStreamable);

      const result = await controller.steal('https://instagram.com/reel/123', 'my_video.mp4');

      expect(memesService.streamVideo).toHaveBeenCalledWith(
        'https://instagram.com/reel/123',
        'my_video.mp4',
        0
      );
      expect(result).toBe(mockStreamable);
    });

    it('should pass undefined filename and 0 retry when queries are omitted', async () => {
      const mockStreamable = {} as StreamableFile;
      memesService.streamVideo.mockResolvedValue(mockStreamable);

      const result = await controller.steal('https://tiktok.com/@user/video/1');

      expect(memesService.streamVideo).toHaveBeenCalledWith(
        'https://tiktok.com/@user/video/1',
        undefined,
        0
      );
      expect(result).toBe(mockStreamable);
    });

    it('should forward positive integer retry count and ignore invalid/non-positive values', async () => {
      const mockStreamable = {} as StreamableFile;
      memesService.streamVideo.mockResolvedValue(mockStreamable);

      await controller.steal('https://tiktok.com/@user/video/1', undefined, '2');
      expect(memesService.streamVideo).toHaveBeenLastCalledWith(
        'https://tiktok.com/@user/video/1',
        undefined,
        2
      );

      await controller.steal('https://tiktok.com/@user/video/1', undefined, 'invalid');
      expect(memesService.streamVideo).toHaveBeenLastCalledWith(
        'https://tiktok.com/@user/video/1',
        undefined,
        0
      );

      await controller.steal('https://tiktok.com/@user/video/1', undefined, '-1');
      expect(memesService.streamVideo).toHaveBeenLastCalledWith(
        'https://tiktok.com/@user/video/1',
        undefined,
        0
      );
    });
  });
});
