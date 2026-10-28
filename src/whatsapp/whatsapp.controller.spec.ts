import { Test, TestingModule } from '@nestjs/testing';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { UnauthorizedException } from '@nestjs/common';

describe('WhatsappController', () => {
  let controller: WhatsappController;
  let whatsappService: WhatsappService;

  beforeEach(async () => {
    whatsappService = {
      verifyWebhookChallenge: jest.fn(),
      verifySignature: jest.fn(),
      handleIncomingWebhook: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WhatsappController],
      providers: [
        {
          provide: WhatsappService,
          useValue: whatsappService,
        },
      ],
    }).compile();

    controller = module.get<WhatsappController>(WhatsappController);
  });

  describe('GET /whatsapp/webhook', () => {
    it('should return challenge code from service', () => {
      (whatsappService.verifyWebhookChallenge as jest.Mock).mockReturnValue('challenge_abc_123');

      const result = controller.verifyWebhook('subscribe', 'token123', 'challenge_abc_123');
      expect(result).toBe('challenge_abc_123');
      expect(whatsappService.verifyWebhookChallenge).toHaveBeenCalledWith(
        'subscribe',
        'token123',
        'challenge_abc_123'
      );
    });
  });

  describe('POST /whatsapp/webhook', () => {
    it('should throw UnauthorizedException when signature verification fails', async () => {
      (whatsappService.verifySignature as jest.Mock).mockReturnValue(false);

      const payload = { object: 'whatsapp_business_account', entry: [] };
      await expect(
        controller.handleWebhook(payload, 'sha256=invalid', { rawBody: 'payload' } as any)
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should delegate to service when signature is valid', async () => {
      (whatsappService.verifySignature as jest.Mock).mockReturnValue(true);
      (whatsappService.handleIncomingWebhook as jest.Mock).mockResolvedValue({
        processed: 1,
        createdTasks: [{ title: 'Task 1', itemId: 'item_1', sender: '380991112233' }],
      });

      const payload = { object: 'whatsapp_business_account', entry: [] };
      const response = await controller.handleWebhook(
        payload,
        'sha256=valid_signature',
        { rawBody: JSON.stringify(payload) } as any
      );

      expect(response.status).toBe('ok');
      expect(response.result.processed).toBe(1);
      expect(whatsappService.handleIncomingWebhook).toHaveBeenCalledWith(payload);
    });
  });
});
