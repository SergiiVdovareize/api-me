import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { DateService } from './date.service';
import { BlobService } from '../blob/blob.service';
import { RedisReader } from '../common/helpers/redisReader';

describe('DateService', () => {
  let service: DateService;
  let mockBlobService: jest.Mocked<Partial<BlobService>>;
  let mockRedisReader: jest.Mocked<Partial<RedisReader>>;

  beforeEach(async () => {
    mockBlobService = {
      read: jest.fn(),
      create: jest.fn(),
    };

    mockRedisReader = {
      read: jest.fn(),
      write: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DateService,
        {
          provide: BlobService,
          useValue: mockBlobService,
        },
        {
          provide: RedisReader,
          useValue: mockRedisReader,
        },
      ],
    }).compile();

    service = module.get<DateService>(DateService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getRandomDate', () => {
    it('should return cached date if it exists in BlobStorage', async () => {
      mockBlobService.read.mockResolvedValue({ date: '12.12.2020' });

      const result = await service.getRandomDate();

      expect(result).toBe('12.12.2020');
      expect(mockBlobService.read).toHaveBeenCalledTimes(1);
      expect(mockRedisReader.read).not.toHaveBeenCalled();
      expect(mockBlobService.create).not.toHaveBeenCalled();
    });

    it('should fall back to Redis if BlobStorage read throws an error', async () => {
      mockBlobService.read.mockRejectedValue(new Error('Vercel Blob Limit'));
      mockRedisReader.read.mockResolvedValue({ date: '15.08.2022' });

      const result = await service.getRandomDate();

      expect(result).toBe('15.08.2022');
      expect(mockBlobService.read).toHaveBeenCalledTimes(1);
      expect(mockRedisReader.read).toHaveBeenCalledTimes(1);
      expect(mockBlobService.create).not.toHaveBeenCalled();
    });

    it('should generate, cache to both, and return a random date if no cache exists', async () => {
      mockBlobService.read.mockResolvedValue(null);
      mockBlobService.create.mockResolvedValue({} as any);
      mockRedisReader.write.mockResolvedValue({} as any);

      const result = await service.getRandomDate();

      expect(result).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);

      const [dd, mm, yyyy] = result.split('.').map(Number);
      const parsedDate = Date.UTC(yyyy, mm - 1, dd);
      const start = Date.UTC(2018, 7, 1);
      const end = Date.UTC(2022, 1, 22);
      expect(parsedDate).toBeGreaterThanOrEqual(start);
      expect(parsedDate).toBeLessThanOrEqual(end);

      expect(mockBlobService.read).toHaveBeenCalledTimes(1);
      expect(mockBlobService.create).toHaveBeenCalledTimes(1);
      expect(mockRedisReader.write).toHaveBeenCalledTimes(1);
      expect(mockRedisReader.write).toHaveBeenCalledWith(expect.stringContaining('date-'), {
        date: result,
      });
    });

    it('should fall back to Redis write if BlobStorage create throws an error but Redis write succeeds', async () => {
      mockBlobService.read.mockResolvedValue(null);
      mockBlobService.create.mockRejectedValue(new Error('Vercel Blob Write Limit'));
      mockRedisReader.write.mockResolvedValue({} as any);

      const result = await service.getRandomDate();

      expect(result).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
      expect(mockBlobService.read).toHaveBeenCalledTimes(1);
      expect(mockBlobService.create).toHaveBeenCalledTimes(1);
      expect(mockRedisReader.write).toHaveBeenCalledTimes(1);
    });

    it('should return null if both BlobStorage and Redis cache writes throw errors', async () => {
      mockBlobService.read.mockResolvedValue(null);
      const loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      mockBlobService.create.mockRejectedValue(new Error('Vercel Blob failed'));
      mockRedisReader.write.mockRejectedValue(new Error('Redis write failed'));

      const result = await service.getRandomDate();

      expect(result).toBeNull();
      expect(loggerSpy).toHaveBeenCalled();
      loggerSpy.mockRestore();
    });
  });
});
