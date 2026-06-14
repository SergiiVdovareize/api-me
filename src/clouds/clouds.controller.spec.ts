import { Test, TestingModule } from '@nestjs/testing';
import { CloudsController } from './clouds.controller';
import { CloudsService } from './clouds.service';
import { RequestsService } from 'src/requests/requests.service';
import { AsyncService } from 'src/async/async.service';

describe('CloudsController', () => {
  let controller: CloudsController;
  let cloudsService: any;
  let requestsService: any;
  let asyncService: any;

  beforeEach(async () => {
    cloudsService = {
      getFibonacciNumber: jest.fn(),
      getPrimeNumber: jest.fn(),
      getArmstrongNumber: jest.fn(),
    };

    requestsService = {
      countFibonacciThisMonth: jest.fn(),
      registerFibonacciApiCall: jest.fn(),
      countPrimeThisMonth: jest.fn(),
      registerPrimeApiCall: jest.fn(),
      countArmstrongThisMonth: jest.fn(),
      registerArmstrongApiCall: jest.fn(),
    };

    asyncService = {
      findResultFileUrlWithRetry: jest.fn(),
      readResult: jest.fn(),
      generateFilename: new AsyncService().generateFilename,
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CloudsController],
      providers: [
        { provide: CloudsService, useValue: cloudsService },
        { provide: RequestsService, useValue: requestsService },
        { provide: AsyncService, useValue: asyncService },
      ],
    }).compile();

    controller = module.get<CloudsController>(CloudsController);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('fibonacci', () => {
    it('should return limitedResponse if monthly limit is exceeded', async () => {
      requestsService.countFibonacciThisMonth.mockResolvedValue(900);
      const result = await controller.fibonacci(10);
      expect(result).toEqual({
        success: false,
        message: 'no more free requests this month, try tomorrow',
      });
      expect(cloudsService.getFibonacciNumber).not.toHaveBeenCalled();
    });

    it('should register call and return service number if under limit', async () => {
      requestsService.countFibonacciThisMonth.mockResolvedValue(899);
      cloudsService.getFibonacciNumber.mockResolvedValue({ success: true, data: 55 });

      const result = await controller.fibonacci(10);
      expect(requestsService.registerFibonacciApiCall).toHaveBeenCalled();
      expect(cloudsService.getFibonacciNumber).toHaveBeenCalledWith(10);
      expect(result).toEqual({ success: true, data: 55 });
    });
  });

  describe('prime', () => {
    it('should return limitedResponse if monthly limit is exceeded', async () => {
      requestsService.countPrimeThisMonth.mockResolvedValue(900);
      const result = await controller.prime(5);
      expect(result).toEqual({
        success: false,
        message: 'no more free requests this month, try tomorrow',
      });
    });

    it('should register call and return service number if under limit', async () => {
      requestsService.countPrimeThisMonth.mockResolvedValue(500);
      cloudsService.getPrimeNumber.mockResolvedValue({ success: true, data: 11 });

      const result = await controller.prime(5);
      expect(requestsService.registerPrimeApiCall).toHaveBeenCalled();
      expect(cloudsService.getPrimeNumber).toHaveBeenCalledWith(5);
      expect(result).toEqual({ success: true, data: 11 });
    });
  });

  describe('armstrong', () => {
    it('should return limitedResponse if monthly limit is exceeded', async () => {
      requestsService.countArmstrongThisMonth.mockResolvedValue(900);
      const result = await controller.armstrong(3);
      expect(result).toEqual({
        success: false,
        message: 'no more free requests this month, try tomorrow',
      });
    });

    it('should register call and return service number if under limit', async () => {
      requestsService.countArmstrongThisMonth.mockResolvedValue(100);
      cloudsService.getArmstrongNumber.mockResolvedValue({ success: true, data: 153 });

      const result = await controller.armstrong(3);
      expect(requestsService.registerArmstrongApiCall).toHaveBeenCalled();
      expect(cloudsService.getArmstrongNumber).toHaveBeenCalledWith(3);
      expect(result).toEqual({ success: true, data: 153 });
    });
  });

  describe('result', () => {
    it('should return invalid response if ID structure is invalid', async () => {
      const result = await controller.result('invalid-id');
      expect(result).toEqual({
        success: false,
        status: 1,
        message: 'result id is not valid',
      });
    });

    it('should return invalid response if ID timestamp is expired', async () => {
      const oldTime = Date.now() - 61 * 60 * 1000;
      jest.useFakeTimers().setSystemTime(oldTime);
      const oldId = asyncService.generateFilename();
      jest.useRealTimers();

      const result = await controller.result(oldId);
      expect(result).toEqual({
        success: false,
        status: 1,
        message: 'result id is not valid',
      });
    });

    it('should return status 2 if result file URL is not found', async () => {
      const validId = asyncService.generateFilename();
      asyncService.findResultFileUrlWithRetry.mockResolvedValue(null);

      const result = await controller.result(validId);
      expect(result).toEqual({
        success: false,
        status: 2,
      });
    });

    it('should return status 3 if result reading fails', async () => {
      const validId = asyncService.generateFilename();
      asyncService.findResultFileUrlWithRetry.mockResolvedValue('https://blob.url/123');
      asyncService.readResult.mockResolvedValue(null);

      const result = await controller.result(validId);
      expect(result).toEqual({
        success: false,
        status: 3,
        message: 'could not read result',
      });
    });

    it('should return content of result if successful', async () => {
      const validId = asyncService.generateFilename();
      asyncService.findResultFileUrlWithRetry.mockResolvedValue('https://blob.url/123');
      asyncService.readResult.mockResolvedValue({ val: 377 });

      const result = await controller.result(validId);
      expect(result).toEqual({ val: 377 });
    });
  });
});
