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
import * as Sentry from '@sentry/nestjs';

jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

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
    jest.clearAllMocks();
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

    it('should throw BadRequestException when upstream returns HTTP 403 Forbidden', async () => {
      mockPrisma.priceProduct.findUnique.mockResolvedValue(null);
      mockSafeFetch.fetchHtml.mockRejectedValue(
        new Error('HTTP 403 Forbidden for https://goodwine.com.ua/item')
      );

      await expect(
        service.createProduct({
          url: 'https://goodwine.com.ua/item',
        })
      ).rejects.toThrow(BadRequestException);
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
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
      expect(mockNotificationService.sendPriceAlert).toHaveBeenCalledWith(
        mockProduct,
        850,
        true,
        'TARGET_PRICE',
        expect.any(Object)
      );
      expect(mockPrisma.priceProduct.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({ lastPrice: 850 }),
        })
      );
    });

    it('should cap price history to MAX_HISTORY_ITEMS (100 entries)', async () => {
      const initialHistory = Array.from({ length: 105 }, (_, i) => ({
        price: 1000 + i,
        inStock: true,
        checkedAt: new Date(Date.now() - (105 - i) * 60000).toISOString(),
      }));

      const mockProduct = {
        id: 11,
        url: 'https://shop.ua/item-history',
        domain: 'shop.ua',
        title: 'History Test Item',
        lastPrice: 1104,
        currency: 'UAH',
        inStock: true,
        status: PriceProductStatus.ACTIVE,
        failCount: 0,
        history: initialHistory,
        chatId: '1252877',
      };

      mockPrisma.priceProduct.findMany.mockResolvedValue([mockProduct]);
      mockJsonLdExtractor.extract.mockResolvedValue({
        title: 'History Test Item',
        price: 1200,
        currency: 'UAH',
        inStock: true,
        strategy: 'JSON_LD',
      });
      mockNotificationService.checkConditions.mockReturnValue({
        shouldNotify: false,
      });
      mockPrisma.priceProduct.update.mockResolvedValue({});

      await service.checkDuePrices();

      expect(mockPrisma.priceProduct.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 11 },
          data: expect.objectContaining({
            lastPrice: 1200,
            history: expect.any(Array),
          }),
        })
      );

      const updateCall = mockPrisma.priceProduct.update.mock.calls.find(
        (call: any) => call[0]?.where?.id === 11
      );
      expect(updateCall[0].data.history.length).toBe(100);
      expect(updateCall[0].data.history[99].price).toBe(1200);
    });

    it('should process multiple due products in concurrent chunks', async () => {
      const mockProducts = [1, 2, 3, 4, 5].map(id => ({
        id,
        url: `https://shop.ua/item-${id}`,
        domain: 'shop.ua',
        title: `Item ${id}`,
        lastPrice: 1000,
        currency: 'UAH',
        inStock: true,
        status: PriceProductStatus.ACTIVE,
        failCount: 0,
        history: [],
      }));

      mockPrisma.priceProduct.findMany.mockResolvedValue(mockProducts);
      mockJsonLdExtractor.extract.mockImplementation(async () => ({
        title: `Item`,
        price: 1000,
        currency: 'UAH',
        inStock: true,
        strategy: 'JSON_LD',
      }));
      mockNotificationService.checkConditions.mockReturnValue({ shouldNotify: false });
      mockPrisma.priceProduct.update.mockResolvedValue({});

      const summary = await service.checkDuePrices();

      expect(summary).toEqual({ checked: 5, changed: 0, failed: 0 });
      expect(mockPrisma.priceProduct.update).toHaveBeenCalledTimes(5);
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
      mockPrisma.priceProduct.update.mockResolvedValue({});

      const summary = await service.checkDuePrices();

      expect(summary).toEqual({ checked: 0, changed: 0, failed: 1 });
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        expect.stringContaining('[PriceTracker Batch] 1 product price check(s) failed'),
        expect.objectContaining({
          level: 'warning',
          tags: { component: 'price-tracker', operation: 'checkDuePrices' },
          fingerprint: ['price-tracker-batch-failures'],
          extra: expect.objectContaining({
            checked: 0,
            changed: 0,
            failed: 1,
            failedProductIds: [2],
          }),
        })
      );
      expect(mockPrisma.priceProduct.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 2 },
          data: expect.objectContaining({ failCount: 1 }),
        })
      );
    });

    it('should track failure when a product processing promise rejects', async () => {
      const mockProduct = {
        id: 7,
        url: 'https://shop.ua/item-reject',
        domain: 'shop.ua',
        title: 'Reject Item',
        lastPrice: 500,
        currency: 'UAH',
        inStock: true,
        status: PriceProductStatus.ACTIVE,
        failCount: 0,
        history: [],
      };

      mockPrisma.priceProduct.findMany.mockResolvedValue([mockProduct]);
      jest.spyOn(service as any, 'processProductWithLock').mockRejectedValueOnce(new Error('Fatal redis crash'));

      const summary = await service.checkDuePrices();
      expect(summary.failed).toBe(1);
      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        expect.stringContaining('[PriceTracker Batch] 1 product price check(s) failed'),
        expect.objectContaining({
          extra: expect.objectContaining({
            failedProducts: expect.arrayContaining([
              expect.objectContaining({ id: 7, reason: 'Fatal redis crash' }),
            ]),
          }),
        })
      );
    });

    it('should reschedule re-check in 10 minutes when price spike > 40% is detected', async () => {
      const spikeProduct = {
        id: 3,
        url: 'https://shop.ua/item-3',
        domain: 'shop.ua',
        title: 'Item 3',
        lastPrice: 1000,
        currency: 'UAH',
        inStock: true,
        status: PriceProductStatus.ACTIVE,
        failCount: 0,
        history: [],
      };

      mockPrisma.priceProduct.findMany.mockResolvedValue([spikeProduct]);
      mockJsonLdExtractor.extract.mockResolvedValue({
        title: 'Item 3',
        price: 500, // 50% drop
        currency: 'UAH',
        inStock: true,
        strategy: 'JSON_LD',
      });

      mockPrisma.priceProduct.update.mockResolvedValue({});

      const summary = await service.checkDuePrices();
      expect(summary).toEqual({ checked: 1, changed: 0, failed: 0 });
      expect(mockPrisma.priceProduct.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 3 },
          data: expect.objectContaining({ failCount: 1 }),
        })
      );
    });

    it('should escalate to ERROR on 3 failures and UNSUPPORTED on 6 failures', async () => {
      const failingProduct = {
        id: 4,
        url: 'https://shop.ua/item-4',
        domain: 'shop.ua',
        title: 'Item 4',
        lastPrice: 100,
        currency: 'UAH',
        inStock: true,
        status: PriceProductStatus.ACTIVE,
        failCount: 2,
        history: [],
      };

      mockPrisma.priceProduct.findMany.mockResolvedValue([failingProduct]);
      mockPrisma.priceProduct.update.mockResolvedValue({});

      await service.checkDuePrices();

      expect(mockPrisma.priceProduct.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 4 },
          data: expect.objectContaining({ status: PriceProductStatus.ERROR, failCount: 3 }),
        })
      );

      const brokenProduct = { ...failingProduct, failCount: 5 };
      mockPrisma.priceProduct.findMany.mockResolvedValue([brokenProduct]);

      await service.checkDuePrices();

      expect(mockPrisma.priceProduct.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 4 },
          data: expect.objectContaining({ status: PriceProductStatus.UNSUPPORTED, failCount: 6 }),
        })
      );
    });

    it('should classify 403 Forbidden as WAF_BLOCKED and report to notificationService', async () => {
      const wafProduct = {
        id: 5,
        url: 'https://foxtrot.com.ua/item-waf',
        domain: 'foxtrot.com.ua',
        title: 'Foxtrot WAF Item',
        lastPrice: 1000,
        currency: 'UAH',
        inStock: true,
        status: PriceProductStatus.ACTIVE,
        failCount: 2,
        history: [],
      };

      mockPrisma.priceProduct.findMany.mockResolvedValue([wafProduct]);
      mockSafeFetch.fetchHtml.mockRejectedValueOnce(
        new Error('HTTP 403 Forbidden (Cloudflare Ray: 123) for https://foxtrot.com.ua/item-waf')
      );
      mockPrisma.priceProduct.update.mockResolvedValue({});

      await service.checkDuePrices();

      expect(mockNotificationService.notifyAdminError).toHaveBeenCalledWith(
        wafProduct,
        expect.stringContaining('Blocked by WAF/Cloudflare (HTTP 403)'),
        expect.objectContaining({
          failureType: 'WAF_BLOCKED',
          failureReason: 'Blocked by WAF/Cloudflare (HTTP 403)',
        })
      );
    });

    it('should classify 404 Not Found as NOT_FOUND and report to notificationService', async () => {
      const notFoundProduct = {
        id: 6,
        url: 'https://goodwine.com.ua/item-404',
        domain: 'goodwine.com.ua',
        title: 'Goodwine 404 Item',
        lastPrice: 500,
        currency: 'UAH',
        inStock: true,
        status: PriceProductStatus.ACTIVE,
        failCount: 2,
        history: [],
      };

      mockPrisma.priceProduct.findMany.mockResolvedValue([notFoundProduct]);
      mockSafeFetch.fetchHtml.mockRejectedValueOnce(
        new Error('HTTP 404 Not Found for https://goodwine.com.ua/item-404')
      );
      mockPrisma.priceProduct.update.mockResolvedValue({});

      await service.checkDuePrices();

      expect(mockNotificationService.notifyAdminError).toHaveBeenCalledWith(
        notFoundProduct,
        expect.stringContaining('Product page not found (HTTP 404)'),
        expect.objectContaining({
          failureType: 'NOT_FOUND',
          failureReason: 'Product page not found (HTTP 404)',
        })
      );
    });

    it('should classify timeout and server errors as NETWORK_ERROR', async () => {
      const timeoutProduct = {
        id: 8,
        url: 'https://slow-shop.ua/item',
        domain: 'slow-shop.ua',
        title: 'Slow Item',
        lastPrice: 300,
        currency: 'UAH',
        inStock: true,
        status: PriceProductStatus.ACTIVE,
        failCount: 2,
        history: [],
      };

      mockPrisma.priceProduct.findMany.mockResolvedValue([timeoutProduct]);
      mockSafeFetch.fetchHtml.mockRejectedValueOnce(
        new Error('Request timed out after 15000ms for https://slow-shop.ua/item')
      );
      mockPrisma.priceProduct.update.mockResolvedValue({});

      await service.checkDuePrices();

      expect(mockNotificationService.notifyAdminError).toHaveBeenCalledWith(
        timeoutProduct,
        expect.stringContaining('Network/server error'),
        expect.objectContaining({
          failureType: 'NETWORK_ERROR',
        })
      );
    });

    it('should extract clothing variants (sizes, colors, currentColor) and save them', async () => {
      const htmlWithVariants = `
        <html>
        <head>
          <script>
            window.__DATA__ = {
              "sizesList": ["S", "M", "L"],
              "unavailableSizesList": []
            };
          </script>
        </head>
        <body>
          <h1>Сукня літня</h1>
          <span class="color-name">Колір: білий</span>
        </body>
        </html>
      `;

      mockSafeFetch.fetchHtml.mockResolvedValue(htmlWithVariants);
      mockJsonLdExtractor.extract.mockResolvedValue({
        title: 'Сукня літня',
        price: 1200,
        currency: 'UAH',
        inStock: true,
        strategy: 'JSON_LD',
      });

      mockPrisma.priceProduct.create.mockResolvedValue({
        id: 10,
        title: 'Сукня літня',
        lastPrice: 1200,
        currency: 'UAH',
        inStock: true,
        strategy: 'JSON_LD',
        url: 'https://shop.ua/dress',
      });

      const res = await service.createProduct({
        url: 'https://shop.ua/dress',
      });

      expect(res.id).toBe(10);
      expect(mockPrisma.priceProduct.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sizes: expect.any(Array),
            colors: expect.any(Array),
          }),
        })
      );
    });
  });
});
