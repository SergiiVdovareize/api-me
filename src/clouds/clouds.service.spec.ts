import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CloudsService } from './clouds.service';
import { AsyncService } from 'src/async/async.service';
import { env } from 'process';

describe('CloudsService', () => {
  let service: CloudsService;
  let asyncService: any;

  beforeEach(async () => {
    asyncService = {
      prepareResult: jest.fn().mockImplementation(async executeFn => {
        // Just call executeFn directly to test the private execute method
        return await executeFn();
      }),
    };

    const mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'FIBONACCI_URL') return env.FIBONACCI_URL;
        if (key === 'PRIME_URL') return env.PRIME_URL;
        if (key === 'ARMSTRONG_URL') return env.ARMSTRONG_URL;
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CloudsService,
        { provide: AsyncService, useValue: asyncService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<CloudsService>(CloudsService);

    env.FIBONACCI_URL = 'https://api.cloud/fib';
    env.PRIME_URL = 'https://api.cloud/prime';
    env.ARMSTRONG_URL = 'https://api.cloud/armstrong';

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getFibonacciNumber', () => {
    it('should query the fibonacci URL and prepare the result', async () => {
      const mockResult = { value: 55 };
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        json: () => Promise.resolve(mockResult),
      } as any);

      const result = await service.getFibonacciNumber(10);
      expect(asyncService.prepareResult).toHaveBeenCalled();
      expect(fetchSpy).toHaveBeenCalledWith('https://api.cloud/fib?index=10');
      expect(result).toEqual(mockResult);
    });
  });

  describe('getPrimeNumber', () => {
    it('should query the prime URL and prepare the result', async () => {
      const mockResult = { value: 13 };
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        json: () => Promise.resolve(mockResult),
      } as any);

      const result = await service.getPrimeNumber(6);
      expect(asyncService.prepareResult).toHaveBeenCalled();
      expect(fetchSpy).toHaveBeenCalledWith('https://api.cloud/prime?index=6');
      expect(result).toEqual(mockResult);
    });
  });

  describe('getArmstrongNumber', () => {
    it('should query the armstrong URL and prepare the result', async () => {
      const mockResult = { value: 153 };
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        json: () => Promise.resolve(mockResult),
      } as any);

      const result = await service.getArmstrongNumber(3);
      expect(asyncService.prepareResult).toHaveBeenCalled();
      expect(fetchSpy).toHaveBeenCalledWith('https://api.cloud/armstrong?index=3');
      expect(result).toEqual(mockResult);
    });
  });
});
