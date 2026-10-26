import { ConfigService } from '@nestjs/config';
import { OutboxQueueService } from './outbox-queue.service';
import { TelegramService } from './telegram.service';
import { google } from 'googleapis';

jest.mock('googleapis', () => {
  const mockValues = {
    append: jest.fn(),
    get: jest.fn(),
    update: jest.fn(),
  };
  const mockSpreadsheets = {
    get: jest.fn(),
    values: mockValues,
  };
  return {
    google: {
      auth: {
        JWT: jest.fn().mockImplementation(() => ({})),
      },
      sheets: jest.fn(() => ({
        spreadsheets: mockSpreadsheets,
      })),
    },
  };
});

describe('OutboxQueueService', () => {
  let service: OutboxQueueService;
  let configService: jest.Mocked<ConfigService>;
  let telegramService: jest.Mocked<TelegramService>;
  let mockSheets: any;

  beforeEach(() => {
    jest.clearAllMocks();

    configService = {
      get: jest.fn((key: string) => {
        if (key === 'GOOGLE_SERVICE_ACCOUNT_EMAIL') return 'test@serviceaccount.com';
        if (key === 'GOOGLE_PRIVATE_KEY')
          return '-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----';
        if (key === 'TELEGRAM_OUTBOX_SPREADSHEET_ID') return 'custom-outbox-id';
        return undefined;
      }),
    } as any;

    telegramService = {
      sendMessage: jest.fn().mockResolvedValue(undefined),
    } as any;

    service = new OutboxQueueService(configService, telegramService);
    mockSheets = (google.sheets as jest.Mock)();
  });

  describe('appendMessageToOutbox', () => {
    it('should append message with custom chatId and resolved tab name', async () => {
      mockSheets.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [{ properties: { title: 'telegram_outbox' } }],
        },
      });
      mockSheets.spreadsheets.values.append.mockResolvedValue({
        data: { updates: { updatedRange: 'telegram_outbox!A2:E2' } },
      });

      await service.appendMessageToOutbox('Hello World', '123456');

      expect(mockSheets.spreadsheets.values.append).toHaveBeenCalledWith(
        expect.objectContaining({
          spreadsheetId: 'custom-outbox-id',
          range: 'telegram_outbox!A:E',
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [
              [
                expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
                'Hello World',
                '123456',
                'HTML',
                'PENDING',
              ],
            ],
          },
        })
      );
    });

    it('should fallback to queue if sheet metadata fails', async () => {
      mockSheets.spreadsheets.get.mockRejectedValue(new Error('API quota exceeded'));
      mockSheets.spreadsheets.values.append.mockResolvedValue({
        data: { updates: { updatedRange: 'queue!A1:E1' } },
      });

      await service.appendMessageToOutbox('Fallback Message');

      expect(mockSheets.spreadsheets.values.append).toHaveBeenCalledWith(
        expect.objectContaining({
          range: 'queue!A:E',
        })
      );
    });

    it('should throw error when append fails', async () => {
      mockSheets.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [{ properties: { title: 'queue' } }],
        },
      });
      mockSheets.spreadsheets.values.append.mockRejectedValue(new Error('Append error'));

      await expect(service.appendMessageToOutbox('Message')).rejects.toThrow('Append error');
    });
  });

  describe('processOutboxQueue', () => {
    beforeEach(() => {
      mockSheets.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [{ properties: { title: 'queue' } }],
        },
      });
    });

    it('should process pending messages, send to Telegram, and update status to SENT', async () => {
      mockSheets.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [
            ['Timestamp', 'Message', 'Chat ID', 'Parse Mode', 'Status', 'Sent At'],
            ['2026-10-26 12:00:00', 'Episode 1 released', '1252877', 'HTML', 'PENDING', ''],
            ['2026-10-26 11:00:00', 'Old message', '1252877', 'HTML', 'SENT', '2026-10-26 11:00:05'],
          ],
        },
      });
      mockSheets.spreadsheets.values.update.mockResolvedValue({});

      const result = await service.processOutboxQueue();

      expect(result.totalRows).toBe(3);
      expect(result.processed).toBe(1);
      expect(result.sent).toBe(1);
      expect(result.errors).toBe(0);
      expect(telegramService.sendMessage).toHaveBeenCalledWith(
        'Episode 1 released',
        '1252877',
        'HTML'
      );
      expect(mockSheets.spreadsheets.values.update).toHaveBeenCalledWith(
        expect.objectContaining({
          range: 'queue!E2:F2',
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [['SENT', expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)]],
          },
        })
      );
    });

    it('should mark row as ERROR if telegram sending fails', async () => {
      mockSheets.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [
            ['Timestamp', 'Message', 'Chat ID', 'Parse Mode', 'Status'],
            ['2026-10-26 12:00:00', 'Failing message', '999', 'HTML', 'PENDING'],
          ],
        },
      });
      telegramService.sendMessage.mockRejectedValue(new Error('Network error'));
      mockSheets.spreadsheets.values.update.mockResolvedValue({});

      const result = await service.processOutboxQueue();

      expect(result.processed).toBe(1);
      expect(result.sent).toBe(0);
      expect(result.errors).toBe(1);
      expect(result.details[0]).toEqual({
        row: 2,
        chatId: '999',
        status: 'ERROR',
        error: 'Network error',
      });
      expect(mockSheets.spreadsheets.values.update).toHaveBeenCalledWith(
        expect.objectContaining({
          range: 'queue!E2',
          requestBody: {
            values: [['ERROR']],
          },
        })
      );
    });

    it('should handle empty rows gracefully', async () => {
      mockSheets.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: null,
        },
      });

      const result = await service.processOutboxQueue();

      expect(result.totalRows).toBe(0);
      expect(result.processed).toBe(0);
      expect(result.sent).toBe(0);
      expect(result.errors).toBe(0);
    });
  });

  describe('configuration and credentials', () => {
    it('should use default spreadsheet ID when TELEGRAM_OUTBOX_SPREADSHEET_ID is not configured', () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'GOOGLE_SERVICE_ACCOUNT_EMAIL') return 'test@serviceaccount.com';
        if (key === 'GOOGLE_PRIVATE_KEY') return 'private-key';
        return undefined;
      });

      const defaultOutboxId = (service as any).getOutboxSpreadsheetId();
      expect(defaultOutboxId).toBe('1zbsVKCvuaFgN4cbn9KNeRKSq3EOT5tsMq2yp6Mpd9dI');
    });

    it('should throw error when service account credentials are missing', () => {
      configService.get.mockReturnValue(undefined);

      expect(() => (service as any).getSheetsClient()).toThrow(
        'Google Service Account credentials missing'
      );
    });
  });
});
