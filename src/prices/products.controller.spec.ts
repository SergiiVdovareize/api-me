import { Test, TestingModule } from '@nestjs/testing';
import { ProductsController } from './products.controller';
import { PricesService } from './prices.service';
import { CreateProductDto } from './dto/create-product.dto';

describe('ProductsController', () => {
  let controller: ProductsController;
  let mockPricesService: jest.Mocked<Partial<PricesService>>;

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

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [
        {
          provide: PricesService,
          useValue: mockPricesService,
        },
      ],
    }).compile();

    controller = module.get<ProductsController>(ProductsController);
  });

  it('should call pricesService.createProduct with provided DTO', async () => {
    const dto: CreateProductDto = {
      url: 'https://rozetka.com.ua/item-123',
      targetPrice: 15000,
    };

    const result = await controller.createProduct(dto);

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
