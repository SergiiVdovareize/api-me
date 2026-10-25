import { Test, TestingModule } from '@nestjs/testing';
import { PricesService } from './prices.service';
import { PrismaService } from '../models/prisma/prisma.service';
import { RedisReader } from '../common/helpers/redisReader';
import { SafeFetchService } from './fetcher/safe-fetch.service';
import { JsonLdExtractor } from './extractors/json-ld.extractor';
import { MetaExtractor } from './extractors/meta.extractor';
import { RecipeExtractor } from './extractors/recipe.extractor';
import { AiExtractor } from './extractors/ai.extractor';
import { NotificationService } from './notification.service';
import { BadRequestException } from '@nestjs/common';
import { PriceProductStatus } from '@prisma/client';

describe('PricesService', () => {
  let service: PricesService;
  let mockPrisma: any;
  let mockRedisReader: any;
  let mockSafeFetch: any;
  let mockJsonLdExtractor: any;
  let mockMetaExtractor: any;
  let mockRecipeExtractor: any;
  let mockAiExtractor: any;
  let mockNotificationService: any;

  beforeEach(async () => {
    mockPrisma = {
      priceProduct: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    mockRedisReader = {
      redis: {
        set: jest.fn().mockResolvedValue('OK'),
        del: jest.fn().mockResolvedValue(1),
      },
    };

    mockSafeFetch = {
      fetchHtml: jest.fn().mockResolvedValue('<html><body>Test</body></html>'),
    };

    mockJsonLdExtractor = {
      extract: jest.fn().mockResolvedValue(null),
    };

    mockMetaExtractor = {
      extract: jest.fn().mockResolvedValue(null),
    };

    mockRecipeExtractor = {
      extract: jest.fn().mockResolvedValue(null),
    };

    mockAiExtractor = {
      extract: jest.fn().mockResolvedValue(null),
    };

    mockNotificationService = {
      checkConditions: jest.fn().mockReturnValue({ shouldNotify: false }),
      sendPriceAlert: jest.fn().mockResolvedValue(undefined),
      notifyAdminError: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PricesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisReader, useValue: mockRedisReader },
        { provide: SafeFetchService, useValue: mockSafeFetch },
        { provide: JsonLdExtractor, useValue: mockJsonLdExtractor },
        { provide: MetaExtractor, useValue: mockMetaExtractor },
        { provide: RecipeExtractor, useValue: mockRecipeExtractor },
        { provide: AiExtractor, useValue: mockAiExtractor },
        { provide: NotificationService, useValue: mockNotificationService },
      ],
    }).compile();

    service = module.get<PricesService>(PricesService);
  });

  describe('createProduct', () => {
    it('should throw BadRequestException if price cannot be extracted', async () => {
      mockPrisma.priceProduct.findUnique.mockResolvedValue(null);

      await expect(service.createProduct({ url: 'https://unknown-shop.ua/item' })).rejects.toThrow(
        BadRequestException
      );
    });

    it('should create product when price is extracted via JSON-LD', async () => {
      mockPrisma.priceProduct.findUnique.mockResolvedValue(null);
      mockJsonLdExtractor.extract.mockResolvedValue({
        title: 'MacBook Pro',
        price: 75000,
        currency: 'UAH',
        inStock: true,
        strategy: 'JSON_LD',
      });

      mockPrisma.priceProduct.create.mockResolvedValue({
        id: 1,
        url: 'https://shop.ua/macbook',
        title: 'MacBook Pro',
        lastPrice: 75000,
        currency: 'UAH',
        inStock: true,
        status: PriceProductStatus.ACTIVE,
      });

      const result = await service.createProduct({
        url: 'https://shop.ua/macbook',
        targetPrice: 70000,
      });

      expect(result.id).toBe(1);
      expect(result.price).toBe(75000);
      expect(mockPrisma.priceProduct.create).toHaveBeenCalled();
    });

    it('should update existing product on duplicate URL without refetching', async () => {
      mockPrisma.priceProduct.findUnique.mockResolvedValue({
        id: 2,
        url: 'https://shop.ua/macbook',
        title: 'MacBook Pro',
        lastPrice: 75000,
        currency: 'UAH',
        inStock: true,
        status: PriceProductStatus.ACTIVE,
        targetPrice: 72000,
      });

      mockPrisma.priceProduct.update.mockResolvedValue({
        id: 2,
        url: 'https://shop.ua/macbook',
        title: 'MacBook Pro',
        lastPrice: 75000,
        currency: 'UAH',
        inStock: true,
        status: PriceProductStatus.ACTIVE,
        targetPrice: 69000,
      });

      const result = await service.createProduct({
        url: 'https://shop.ua/macbook?utm_source=google',
        targetPrice: 69000,
      });

      expect(result.id).toBe(2);
      expect(mockSafeFetch.fetchHtml).not.toHaveBeenCalled();
      expect(mockPrisma.priceProduct.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 2 },
          data: expect.objectContaining({ targetPrice: 69000 }),
        })
      );
    });
  });

  describe('checkDuePrices', () => {
    it('should process due products and notify if price dropped', async () => {
      const mockProduct = {
        id: 1,
        url: 'https://shop.ua/item-1',
        domain: 'shop.ua',
        title: 'Item 1',
        lastPrice: 1000,
        currency: 'UAH',
        inStock: true,
        status: PriceProductStatus.ACTIVE,
        targetPrice: 900,
        dropPercent: 10,
        failCount: 0,
        history: [{ price: 1000, inStock: true, checkedAt: new Date().toISOString() }],
        chatId: '1252877',
      };

      mockPrisma.priceProduct.findMany.mockResolvedValue([mockProduct]);
      mockJsonLdExtractor.extract.mockResolvedValue({
        title: 'Item 1',
        price: 850,
        currency: 'UAH',
        inStock: true,
        strategy: 'JSON_LD',
      });

      mockNotificationService.checkConditions.mockReturnValue({
        shouldNotify: true,
        reason: 'TARGET_PRICE',
      });

      mockPrisma.priceProduct.update.mockResolvedValue({});

      const summary = await service.checkDuePrices();

      expect(summary).toEqual({ checked: 1, changed: 1, failed: 0 });
      expect(mockNotificationService.sendPriceAlert).toHaveBeenCalledWith(
        mockProduct,
        850,
        true,
        'TARGET_PRICE'
      );
      expect(mockPrisma.priceProduct.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({ lastPrice: 850 }),
        })
      );
    });

    it('should increment failCount and set backoff on parsing failure', async () => {
      const mockProduct = {
        id: 2,
        url: 'https://shop.ua/item-2',
        domain: 'shop.ua',
        title: 'Item 2',
        lastPrice: 500,
        currency: 'UAH',
        inStock: true,
        status: PriceProductStatus.ACTIVE,
        failCount: 0,
        history: [],
      };

      mockPrisma.priceProduct.findMany.mockResolvedValue([mockProduct]);
      // all extractors return null
      mockPrisma.priceProduct.update.mockResolvedValue({});

      const summary = await service.checkDuePrices();

      expect(summary).toEqual({ checked: 0, changed: 0, failed: 1 });
      expect(mockPrisma.priceProduct.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 2 },
          data: expect.objectContaining({ failCount: 1 }),
        })
      );
    });
  });
});
