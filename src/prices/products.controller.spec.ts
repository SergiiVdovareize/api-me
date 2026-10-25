import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ProductsController } from './products.controller';
import { PricesService } from './prices.service';
import { CreateProductDto } from './dto/create-product.dto';

describe('ProductsController', () => {
  let controller: ProductsController;
  let mockPricesService: jest.Mocked<Partial<PricesService>>;
  let mockConfigService: any;

  beforeEach(async () => {
    mockPricesService = {
      createProduct: jest.fn().mockResolvedValue({
        id: 1,
        url: 'https://rozetka.com.ua/item-123',
        title: 'Телевізор',
        price: 15999,
        currency: 'UAH',
        inStock: true,
        status: 'ACTIVE',
      }),
    };

    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'CRON_SECRET') return 'test-cron-secret';
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
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

    controller = module.get<ProductsController>(ProductsController);
  });

  it('should throw UnauthorizedException if secret is missing or invalid', async () => {
    const dto: CreateProductDto = {
      url: 'https://rozetka.com.ua/item-123',
      targetPrice: 15000,
    };

    await expect(controller.createProduct(dto, undefined, undefined, undefined)).rejects.toThrow(
      UnauthorizedException
    );
    await expect(
      controller.createProduct(dto, 'wrong-secret', undefined, undefined)
    ).rejects.toThrow(UnauthorizedException);
    expect(mockPricesService.createProduct).not.toHaveBeenCalled();
  });

  it('should call pricesService.createProduct when valid secret is provided', async () => {
    const dto: CreateProductDto = {
      url: 'https://rozetka.com.ua/item-123',
      targetPrice: 15000,
    };

    const result = await controller.createProduct(dto, 'test-cron-secret');

    expect(result).toEqual({
      id: 1,
      url: 'https://rozetka.com.ua/item-123',
      title: 'Телевізор',
      price: 15999,
      currency: 'UAH',
      inStock: true,
      status: 'ACTIVE',
    });
    expect(mockPricesService.createProduct).toHaveBeenCalledWith(dto);
  });
});
