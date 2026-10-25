import { Test, TestingModule } from '@nestjs/testing';
import { PricesController } from './prices.controller';
import { PricesService } from './prices.service';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';

describe('PricesController', () => {
  let controller: PricesController;
  let mockPricesService: jest.Mocked<Partial<PricesService>>;
  let mockConfigService: any;

  beforeEach(async () => {
    mockPricesService = {
      checkDuePrices: jest.fn().mockResolvedValue({
        checked: 5,
        changed: 1,
        failed: 0,
      }),
    };

    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'PRICES_CHECK_SECRET') return 'test-cron-secret-123';
        return null;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PricesController],
      providers: [
        {
          provide: PricesService,
          useValue: mockPricesService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    controller = module.get<PricesController>(PricesController);
  });

  it('should successfully run checkPrices when valid secret is provided in header', async () => {
    const result = await controller.checkPrices('test-cron-secret-123');

    expect(result).toEqual({ checked: 5, changed: 1, failed: 0 });
    expect(mockPricesService.checkDuePrices).toHaveBeenCalledTimes(1);
  });

  it('should throw UnauthorizedException when secret is missing', async () => {
    await expect(controller.checkPrices(undefined)).rejects.toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException when secret does not match', async () => {
    await expect(controller.checkPrices('wrong-secret')).rejects.toThrow(UnauthorizedException);
  });
});
