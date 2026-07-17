import { Test, TestingModule } from '@nestjs/testing';
import { CacheService } from './cache.service';
import { BlobService } from '../blob/blob.service';
import { RedisReader } from 'src/common/helpers/redisReader';

describe('CacheService', () => {
  let service: CacheService;
  let blobService: any;
  let redisReader: any;

  beforeEach(async () => {
    blobService = {
      list: jest.fn(),
      remove: jest.fn(),
    };
    redisReader = {
      nudgeAll: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheService,
        { provide: BlobService, useValue: blobService },
        { provide: RedisReader, useValue: redisReader },
      ],
    }).compile();

    service = module.get<CacheService>(CacheService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('isItemOld', () => {
    it('should return false for missing date', () => {
      expect(service.isItemOld(null as any)).toBe(false);
    });

    it('should identify old items correctly', () => {
      const longAgo = new Date();
      longAgo.setDate(longAgo.getDate() - 2); // 2 days ago
      expect(service.isItemOld(longAgo)).toBe(true);

      const recent = new Date(); // now
      expect(service.isItemOld(recent)).toBe(false);
    });
  });

  describe('refresh', () => {
    it('should do nothing if blob list is empty', async () => {
      blobService.list.mockResolvedValue([]);
      await service.refresh();
      expect(blobService.remove).not.toHaveBeenCalled();
    });

    it('should delete old items (up to 100)', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 2);

      const newDate = new Date();

      const items = [];
      // 110 old items, 10 new items
      for (let i = 0; i < 110; i++) {
        items.push({ pathname: `old-${i}`, uploadedAt: oldDate });
      }
      for (let i = 0; i < 10; i++) {
        items.push({ pathname: `new-${i}`, uploadedAt: newDate });
      }

      blobService.list.mockResolvedValue(items);
      await service.refresh();

      // Should remove only up to MAX_ITEMS_TO_REMOVE (100)
      expect(blobService.remove).toHaveBeenCalledTimes(100);
      expect(blobService.remove).toHaveBeenCalledWith('old-0');
      expect(blobService.remove).toHaveBeenCalledWith('old-99');
      expect(blobService.remove).not.toHaveBeenCalledWith('old-100');
      expect(blobService.remove).not.toHaveBeenCalledWith('new-0');
    });
  });

  describe('nudge', () => {
    it('should call redisReader.nudgeAll', async () => {
      await service.nudge();
      expect(redisReader.nudgeAll).toHaveBeenCalled();
    });
  });
});
