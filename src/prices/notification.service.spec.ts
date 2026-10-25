import { NotificationService } from './notification.service';
import { GoogleSheetsService } from '../series-tracker/services/google-sheets.service';
import { PriceProduct, PriceProductStatus } from '@prisma/client';

describe('NotificationService', () => {
  let service: NotificationService;
  let mockGoogleSheetsService: jest.Mocked<Partial<GoogleSheetsService>>;

  const mockProduct: PriceProduct = {
    id: 1,
    url: 'https://example.com/item',
    domain: 'example.com',
    title: 'Тестовий товар',
    lastPrice: 1000,
    currency: 'UAH',
    inStock: true,
    status: PriceProductStatus.ACTIVE,
    targetPrice: 900,
    dropPercent: 10,
    notifyOnRestock: true,
    lastNotifiedPrice: null,
    chatId: '1252877',
    selector: null,
    sizes: null,
    colors: null,
    desiredSize: null,
    desiredColor: null,
    failCount: 0,
    history: [],
    lastCheckedAt: new Date(),
    nextCheckAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    mockGoogleSheetsService = {
      appendMessageToOutbox: jest.fn().mockResolvedValue(undefined),
    };
    service = new NotificationService(mockGoogleSheetsService as unknown as GoogleSheetsService);
  });

  describe('checkConditions', () => {
    it('should trigger TARGET_PRICE when new price is at or below target', () => {
      const result = service.checkConditions(mockProduct, 850, true);
      expect(result).toEqual({ shouldNotify: true, reason: 'TARGET_PRICE' });
    });

    it('should trigger DROP_PERCENT when price drops by more than specified percentage', () => {
      const productNoTarget = { ...mockProduct, targetPrice: null };
      const result = service.checkConditions(productNoTarget, 890, true);
      expect(result).toEqual({ shouldNotify: true, reason: 'DROP_PERCENT' });
    });

    it('should notify on any price drop by default if neither targetPrice nor dropPercent is set', () => {
      const defaultProduct = { ...mockProduct, targetPrice: null, dropPercent: null };
      const result = service.checkConditions(defaultProduct, 950, true);
      expect(result).toEqual({ shouldNotify: true, reason: 'DROP_PERCENT' });
    });

    it('should trigger RESTOCK when product comes back in stock', () => {
      const outOfStockProduct = { ...mockProduct, inStock: false };
      const result = service.checkConditions(outOfStockProduct, 1000, true);
      expect(result).toEqual({ shouldNotify: true, reason: 'RESTOCK' });
    });

    it('should trigger NEW_SIZE when a previously missing size appears', () => {
      const apparelProduct = { ...mockProduct, sizes: ['S', 'M'] };
      const result = service.checkConditions(apparelProduct, 1000, true, ['S', 'M', 'L']);
      expect(result).toEqual({ shouldNotify: true, reason: 'NEW_SIZE', newSizes: ['L'] });
    });

    it('should trigger NEW_SIZE when desiredSize becomes available', () => {
      const apparelProduct = { ...mockProduct, sizes: ['S'], desiredSize: 'M' };
      const result = service.checkConditions(apparelProduct, 1000, true, ['S', 'M']);
      expect(result).toEqual({ shouldNotify: true, reason: 'NEW_SIZE', newSizes: ['M'] });
    });

    it('should trigger NEW_COLOR when a new color becomes available', () => {
      const apparelProduct = { ...mockProduct, colors: ['чорний'] };
      const result = service.checkConditions(apparelProduct, 1000, true, undefined, [
        'чорний',
        'білий',
      ]);
      expect(result).toEqual({ shouldNotify: true, reason: 'NEW_COLOR', newColors: ['білий'] });
    });

    it('should not notify when price is identical to lastNotifiedPrice and no variant changed', () => {
      const notifiedProduct = { ...mockProduct, lastNotifiedPrice: 850 };
      const result = service.checkConditions(notifiedProduct, 850, true);
      expect(result.shouldNotify).toBe(false);
    });
  });

  describe('sendPriceAlert', () => {
    it('should append alert message to Telegram Outbox sheet with sizes and colors', async () => {
      await service.sendPriceAlert(mockProduct, 850, true, 'NEW_SIZE', {
        sizes: ['XXS', 'XS', 'S', 'M', 'L'],
        currentColor: 'світло-сірий',
        newSizes: ['M'],
      });

      expect(mockGoogleSheetsService.appendMessageToOutbox).toHaveBeenCalledTimes(1);
      expect(mockGoogleSheetsService.appendMessageToOutbox).toHaveBeenCalledWith(
        expect.stringContaining("З'явився новий розмір: M!"),
        '1252877'
      );
      expect(mockGoogleSheetsService.appendMessageToOutbox).toHaveBeenCalledWith(
        expect.stringContaining('Розміри в наявності:</b> XXS, XS, S, M, L'),
        '1252877'
      );
    });
  });
});
