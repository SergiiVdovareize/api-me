import { Test, TestingModule } from '@nestjs/testing';
import { CacheController } from './cache.controller';
import { CacheService } from './cache.service';

describe('CacheController', () => {
  let controller: CacheController;
  let service: any;

  beforeEach(async () => {
    service = {
      refresh: jest.fn(),
      nudge: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CacheController],
      providers: [{ provide: CacheService, useValue: service }],
    }).compile();

    controller = module.get<CacheController>(CacheController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('refresh', () => {
    it('should call cacheService.refresh and return success', async () => {
      const result = await controller.refresh();
      expect(service.refresh).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });
  });

  describe('nudge', () => {
    it('should call cacheService.nudge and return success', async () => {
      const result = await controller.nudge();
      expect(service.nudge).toHaveBeenCalled();
      expect(result).toEqual({ success: true });
    });
  });
});
