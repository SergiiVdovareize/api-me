import { Test, TestingModule } from '@nestjs/testing';
import { AsyncController } from './async.controller';
import { AsyncService } from './async.service';

describe('AsyncController', () => {
  let controller: AsyncController;
  let service: any;

  beforeEach(async () => {
    service = {
      findResultFileUrlWithRetry: jest.fn(),
      readResult: jest.fn(),
      generateFilename: new AsyncService().generateFilename, // reuse actual implementation to generate test IDs
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AsyncController],
      providers: [{ provide: AsyncService, useValue: service }],
    }).compile();

    controller = module.get<AsyncController>(AsyncController);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
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
      // Create a filename for an old timestamp
      const oldTime = Date.now() - 61 * 60 * 1000; // 61 minutes ago
      jest.useFakeTimers().setSystemTime(oldTime);
      const oldId = service.generateFilename();
      jest.useRealTimers();

      const result = await controller.result(oldId);
      expect(result).toEqual({
        success: false,
        status: 1,
        message: 'result id is not valid',
      });
    });

    it('should return invalid response if ID timestamp is in the future', async () => {
      // Create a filename for future timestamp
      const futureTime = Date.now() + 5 * 60 * 1000; // 5 mins in future
      jest.useFakeTimers().setSystemTime(futureTime);
      const futureId = service.generateFilename();
      jest.useRealTimers();

      const result = await controller.result(futureId);
      expect(result).toEqual({
        success: false,
        status: 1,
        message: 'result id is not valid',
      });
    });

    it('should return status 2 if result file URL is not found', async () => {
      const validId = service.generateFilename();
      service.findResultFileUrlWithRetry.mockResolvedValue(null);

      const result = await controller.result(validId);
      expect(service.findResultFileUrlWithRetry).toHaveBeenCalledWith(validId);
      expect(result).toEqual({
        success: false,
        status: 2,
      });
    });

    it('should return status 3 if result reading fails', async () => {
      const validId = service.generateFilename();
      service.findResultFileUrlWithRetry.mockResolvedValue('https://blob.url/123');
      service.readResult.mockResolvedValue(null);

      const result = await controller.result(validId);
      expect(service.findResultFileUrlWithRetry).toHaveBeenCalledWith(validId);
      expect(service.readResult).toHaveBeenCalledWith('https://blob.url/123');
      expect(result).toEqual({
        success: false,
        status: 3,
        message: 'could not read result',
      });
    });

    it('should return content of result if successful', async () => {
      const validId = service.generateFilename();
      service.findResultFileUrlWithRetry.mockResolvedValue('https://blob.url/123');
      service.readResult.mockResolvedValue({ myData: 'hello' });

      const result = await controller.result(validId);
      expect(service.findResultFileUrlWithRetry).toHaveBeenCalledWith(validId);
      expect(service.readResult).toHaveBeenCalledWith('https://blob.url/123');
      expect(result).toEqual({ myData: 'hello' });
    });
  });
});
