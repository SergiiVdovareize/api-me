import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';
import { TelegramUpdate } from './interfaces/telegram.interface';

describe('TelegramController', () => {
  let controller: TelegramController;
  let telegramService: jest.Mocked<Partial<TelegramService>>;
  let configService: jest.Mocked<Partial<ConfigService>>;

  beforeEach(async () => {
    telegramService = {
      handleIncomingUpdate: jest.fn().mockResolvedValue({
        processed: 1,
        createdTasks: [
          {
            title: 'feat: new task',
            itemId: 'item_123',
            senderId: '12345',
          },
        ],
      }),
    };

    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'TELEGRAM_BOT_SECRET_TOKEN') return 'valid_secret';
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TelegramController],
      providers: [
        { provide: TelegramService, useValue: telegramService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    controller = module.get<TelegramController>(TelegramController);
  });

  describe('getWebhookHealth', () => {
    it('should return status ok and service name', () => {
      const res = controller.getWebhookHealth();
      expect(res.status).toBe('ok');
      expect(res.service).toBe('telegram-webhook');
      expect(res.timestamp).toBeDefined();
    });
  });

  describe('handleWebhook', () => {
    const mockUpdate: TelegramUpdate = {
      update_id: 1,
      message: {
        message_id: 10,
        chat: { id: 12345, type: 'private' },
        date: 1720000000,
        text: 'test task',
      },
    };

    it('should throw ForbiddenException if secret token does not match', async () => {
      await expect(
        controller.handleWebhook(mockUpdate, 'invalid_secret')
      ).rejects.toThrow(ForbiddenException);
    });

    it('should process webhook when secret token matches', async () => {
      const res = await controller.handleWebhook(mockUpdate, 'valid_secret');
      expect(res.status).toBe('ok');
      expect(res.result?.processed).toBe(1);
      expect(telegramService.handleIncomingUpdate).toHaveBeenCalledWith(mockUpdate);
    });

    it('should process webhook without secret token header when delegating authorization to service', async () => {
      const res = await controller.handleWebhook(mockUpdate);
      expect(res.status).toBe('ok');
      expect(res.result?.processed).toBe(1);
    });

    it('should return error status without throwing if service throws', async () => {
      (telegramService.handleIncomingUpdate as jest.Mock).mockRejectedValueOnce(
        new Error('Processing failure')
      );
      const res = await controller.handleWebhook(mockUpdate, 'valid_secret');
      expect(res.status).toBe('error');
      expect(res.message).toBe('Processing failure');
    });
  });
});
