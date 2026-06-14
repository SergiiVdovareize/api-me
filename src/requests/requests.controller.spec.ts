import { Test, TestingModule } from '@nestjs/testing';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';

describe('RequestsController', () => {
  let controller: RequestsController;
  let service: any;

  beforeEach(async () => {
    service = {
      countAll: jest.fn(),
      countAllThisMonth: jest.fn(),
      countType: jest.fn(),
      countTypeThisMonth: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RequestsController],
      providers: [{ provide: RequestsService, useValue: service }],
    }).compile();

    controller = module.get<RequestsController>(RequestsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('count', () => {
    it('should return service countAll', async () => {
      service.countAll.mockResolvedValue(100);
      const result = await controller.count();
      expect(service.countAll).toHaveBeenCalled();
      expect(result).toBe(100);
    });
  });

  describe('countThisMonth', () => {
    it('should return service countAllThisMonth', async () => {
      service.countAllThisMonth.mockResolvedValue(50);
      const result = await controller.countThisMonth();
      expect(service.countAllThisMonth).toHaveBeenCalled();
      expect(result).toBe(50);
    });
  });

  describe('countType', () => {
    it('should return service countType', async () => {
      service.countType.mockResolvedValue(10);
      const result = await controller.countType(2);
      expect(service.countType).toHaveBeenCalledWith(2);
      expect(result).toBe(10);
    });
  });

  describe('countTypeThisMonth', () => {
    it('should return service countTypeThisMonth', async () => {
      service.countTypeThisMonth.mockResolvedValue(5);
      const result = await controller.countTypeThisMonth(3);
      expect(service.countTypeThisMonth).toHaveBeenCalledWith(3);
      expect(result).toBe(5);
    });
  });
});
