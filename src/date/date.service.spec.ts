import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { DateService } from './date.service';
import { BlobService } from '../blob/blob.service';

describe('DateService', () => {
  let service: DateService;
  let mockBlobService: jest.Mocked<Partial<BlobService>>;

  beforeEach(async () => {
    mockBlobService = {
      read: jest.fn(),
      create: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DateService,
        {
          provide: BlobService,
          useValue: mockBlobService,
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
      expect(mockBlobService.create).not.toHaveBeenCalled();
    });

    it('should generate, cache, and return a random date if no cache exists', async () => {
      mockBlobService.read.mockResolvedValue(null);
      mockBlobService.create.mockResolvedValue({} as any);

      const result = await service.getRandomDate();

      // Verify returned date matches format dd.mm.yyyy
      expect(result).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);

      // Verify correct ranges
      const [dd, mm, yyyy] = result.split('.').map(Number);
      const parsedDate = Date.UTC(yyyy, mm - 1, dd);
      const start = Date.UTC(2018, 7, 1);
      const end = Date.UTC(2022, 1, 22);
      expect(parsedDate).toBeGreaterThanOrEqual(start);
      expect(parsedDate).toBeLessThanOrEqual(end);

      expect(mockBlobService.read).toHaveBeenCalledTimes(1);
      expect(mockBlobService.create).toHaveBeenCalledTimes(1);
      expect(mockBlobService.create).toHaveBeenCalledWith(expect.stringContaining('date-'), {
        date: result,
      });
    });

    it('should catch cache write errors, log them, and return null', async () => {
      mockBlobService.read.mockResolvedValue(null);
      const loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      mockBlobService.create.mockRejectedValue(new Error('Write failed'));

      const result = await service.getRandomDate();

      expect(result).toBeNull();
      expect(loggerSpy).toHaveBeenCalled();
      loggerSpy.mockRestore();
    });
  });
});
