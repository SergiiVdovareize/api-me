import { WhatsappService } from './whatsapp.service';
import { ConfigService } from '@nestjs/config';
import { LlmService } from '../llm/llm.service';
import { TranscriptionService } from './services/transcription.service';
import { WhatsappProjectBoardService } from './services/whatsapp-project-board.service';
import { ForbiddenException } from '@nestjs/common';
import * as crypto from 'crypto';

describe('WhatsappService', () => {
  let service: WhatsappService;
  let configService: ConfigService;
  let llmService: LlmService;
  let transcriptionService: TranscriptionService;
  let projectBoardService: WhatsappProjectBoardService;
  const originalFetch = global.fetch;

  beforeEach(() => {
    configService = {
      get: jest.fn(),
    } as any;
    llmService = {
      callAndParseJSON: jest.fn(),
    } as any;
    transcriptionService = {
      transcribeAudio: jest.fn(),
    } as any;
    projectBoardService = {
      createDraftItem: jest.fn(),
    } as any;

    service = new WhatsappService(
      configService,
      llmService,
      transcriptionService,
      projectBoardService
    );
    jest.clearAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe('verifyWebhookChallenge', () => {
    it('should return challenge when token matches', () => {
      (configService.get as jest.Mock).mockReturnValue('my_secret_verify_token');

      const result = service.verifyWebhookChallenge(
        'subscribe',
        'my_secret_verify_token',
        'challenge_code_123'
      );
      expect(result).toBe('challenge_code_123');
    });

    it('should throw ForbiddenException when token does not match', () => {
      (configService.get as jest.Mock).mockReturnValue('my_secret_verify_token');

      expect(() =>
        service.verifyWebhookChallenge('subscribe', 'wrong_token', 'challenge_code_123')
      ).toThrow(ForbiddenException);
    });
  });

  describe('verifySignature', () => {
    it('should return true when WHATSAPP_APP_SECRET is not configured', () => {
      (configService.get as jest.Mock).mockReturnValue(undefined);

      expect(service.verifySignature('body', undefined)).toBe(true);
    });

    it('should validate valid HMAC sha256 signature', () => {
      const secret = 'app_secret_123';
      (configService.get as jest.Mock).mockReturnValue(secret);

      const body = '{"hello":"world"}';
      const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');

      expect(service.verifySignature(body, `sha256=${signature}`)).toBe(true);
    });

    it('should reject invalid HMAC signature', () => {
      (configService.get as jest.Mock).mockReturnValue('app_secret_123');

      expect(service.verifySignature('body', 'sha256=invalidhex00000000000000000000000000000000000000000000000000000000')).toBe(
        false
      );
    });
  });

  describe('handleIncomingWebhook', () => {
    it('should process incoming text message and create project board draft item', async () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'WHATSAPP_AUTHORIZED_NUMBERS') return '380991234567';
        if (key === 'WHATSAPP_ACCESS_TOKEN') return 'meta_access_token';
        return undefined;
      });

      (llmService.callAndParseJSON as jest.Mock).mockResolvedValueOnce({
        title: 'feat(payments): integrate Apple Pay',
        body: '## Overview\nApple Pay support\n\n## Acceptance Criteria\n- [ ] Works',
      });
      (projectBoardService.createDraftItem as jest.Mock).mockResolvedValueOnce('PVTI_item_999');

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValueOnce({}),
      } as any);

      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'WHATSAPP_ID',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    phone_number_id: 'PN_12345',
                  },
                  messages: [
                    {
                      from: '+380991234567',
                      id: 'wamid.123',
                      timestamp: '1720000000',
                      type: 'text',
                      text: {
                        body: 'Додати підтримку Apple Pay',
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const result = await service.handleIncomingWebhook(payload);

      expect(result.processed).toBe(1);
      expect(result.createdTasks).toHaveLength(1);
      expect(result.createdTasks[0].title).toBe('feat(payments): integrate Apple Pay');
      expect(result.createdTasks[0].itemId).toBe('PVTI_item_999');
      expect(projectBoardService.createDraftItem).toHaveBeenCalledWith(
        'feat(payments): integrate Apple Pay',
        expect.stringContaining('Apple Pay support')
      );
    });

    it('should process incoming voice note message, download audio, transcribe, and create board item', async () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'WHATSAPP_AUTHORIZED_NUMBERS') return undefined; // No whitelist = allow
        if (key === 'WHATSAPP_ACCESS_TOKEN') return 'meta_access_token';
        return undefined;
      });

      // Mock media download
      jest.spyOn(service, 'downloadMedia').mockResolvedValueOnce(Buffer.from('fake-audio-bytes'));
      (transcriptionService.transcribeAudio as jest.Mock).mockResolvedValueOnce(
        'Виправити баг з подвійним списанням коштів'
      );
      (llmService.callAndParseJSON as jest.Mock).mockResolvedValueOnce({
        title: 'fix(billing): resolve duplicate charge on checkout',
        body: '## Overview\nResolve duplicate charge bug',
      });
      (projectBoardService.createDraftItem as jest.Mock).mockResolvedValueOnce('PVTI_voice_item_1');

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValueOnce({}),
      } as any);

      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'WHATSAPP_ID',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    phone_number_id: 'PN_12345',
                  },
                  messages: [
                    {
                      from: '380998887766',
                      id: 'wamid.voice1',
                      timestamp: '1720000000',
                      type: 'audio',
                      audio: {
                        id: 'MEDIA_ID_AUDIO_1',
                        mime_type: 'audio/ogg; codecs=opus',
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const result = await service.handleIncomingWebhook(payload);

      expect(result.processed).toBe(1);
      expect(transcriptionService.transcribeAudio).toHaveBeenCalledWith(
        Buffer.from('fake-audio-bytes'),
        'audio/ogg; codecs=opus'
      );
      expect(result.createdTasks[0].title).toBe('fix(billing): resolve duplicate charge on checkout');
      expect(projectBoardService.createDraftItem).toHaveBeenCalledWith(
        'fix(billing): resolve duplicate charge on checkout',
        expect.stringContaining('Resolve duplicate charge bug')
      );
    });

    it('should reject unauthorized sender when whitelist is configured', async () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'WHATSAPP_AUTHORIZED_NUMBERS') return '380501112233';
        return undefined;
      });

      jest.spyOn(service, 'sendReply').mockResolvedValue();

      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'WHATSAPP_ID',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { phone_number_id: 'PN_12345' },
                  messages: [
                    {
                      from: '380999999999', // Not in whitelist
                      id: 'wamid.spam',
                      timestamp: '1720000000',
                      type: 'text',
                      text: { body: 'Spam task' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const result = await service.handleIncomingWebhook(payload);

      expect(result.processed).toBe(1);
      expect(result.createdTasks).toHaveLength(0);
      expect(projectBoardService.createDraftItem).not.toHaveBeenCalled();
      expect(service.sendReply).toHaveBeenCalledWith(
        'PN_12345',
        '380999999999',
        expect.stringContaining('not authorized')
      );
    });
  });
});
