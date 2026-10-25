import { ConfigService } from '@nestjs/config';
import { OutboxQueueService } from './outbox-queue.service';
import { google } from 'googleapis';

jest.mock('googleapis', () => {
  const mockValues = {
    append: jest.fn(),
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

    service = new OutboxQueueService(configService);
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
