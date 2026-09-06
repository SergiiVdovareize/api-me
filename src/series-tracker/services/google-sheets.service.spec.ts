import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GoogleSheetsService } from './google-sheets.service';
import { google } from 'googleapis';

jest.mock('googleapis', () => {
  const mSheets = {
    spreadsheets: {
      get: jest.fn(),
      values: {
        get: jest.fn(),
        update: jest.fn(),
        append: jest.fn(),
        batchUpdate: jest.fn(),
      },
    },
  };
  return {
    google: {
      auth: {
        JWT: jest.fn().mockImplementation(() => ({})),
      },
      sheets: jest.fn().mockReturnValue(mSheets),
    },
  };
});

describe('GoogleSheetsService', () => {
  let service: GoogleSheetsService;
  let configService: { get: jest.Mock };
  let mockSheets: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSheets = google.sheets({ version: 'v4' });

    configService = {
      get: jest.fn((key: string) => {
        if (key === 'GOOGLE_SERVICE_ACCOUNT_EMAIL')
          return 'test-sa@project.iam.gserviceaccount.com';
        if (key === 'GOOGLE_PRIVATE_KEY')
          return '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----';
        if (key === 'SERIES_SPREADSHEET_ID') return 'custom-series-sheet-id';
        if (key === 'TELEGRAM_OUTBOX_SPREADSHEET_ID') return 'custom-outbox-sheet-id';
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [GoogleSheetsService, { provide: ConfigService, useValue: configService }],
    }).compile();

    service = module.get<GoogleSheetsService>(GoogleSheetsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('extractEnglishTitle', () => {
    it('should extract English title from multi-language slashed title', () => {
      expect(service.extractEnglishTitle('Таємниця бункера / Бункер / Silo')).toBe('silo');
      expect(service.extractEnglishTitle('Розрив / Поділ / Severance')).toBe('severance');
      expect(service.extractEnglishTitle('Дім дракона / House of the Dragon')).toBe(
        'house of the dragon'
      );
    });

    it('should strip season parentheses from English segment', () => {
      expect(service.extractEnglishTitle('Поділ (Сезон 2) / Severance (Season 2)')).toBe(
        'severance'
      );
    });

    it('should extract from parentheses if title has no slashes', () => {
      expect(service.extractEnglishTitle('Таємниця бункера (Silo)')).toBe('silo');
    });

    it('should fallback to seriesId if title is purely Cyrillic', () => {
      expect(service.extractEnglishTitle('Таємниця бункера', 'silo')).toBe('silo');
      expect(service.extractEnglishTitle('Повільні коні', 'slow-horses')).toBe('slow horses');
    });

    it('should extract English title with subtitles and colons', () => {
      expect(
        service.extractEnglishTitle('Справжній детектив / True Detective: Night Country')
      ).toBe('true detective: night country');
    });
  });

  describe('buildTolokaSearchUrl', () => {
    it('should build valid tracker search URL with escaped english title', () => {
      const url = service.buildTolokaSearchUrl('slow horses');
      expect(url).toContain('nm=slow%20horses&pn=');
      expect(url.startsWith('https://toloka.to/tracker.php?')).toBe(true);
    });
  });

  describe('getTrackedSeries', () => {
    it('should fetch and parse tracked series from Series tab', async () => {
      mockSheets.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [{ properties: { title: 'Series' } }],
        },
      });

      mockSheets.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [
            [
              'silo',
              'Таємниця бункера / Silo',
              'https://uakino.best/silo.html',
              '2',
              '8',
              '1080p',
              'Active',
              '2026-09-05 10:00',
            ],
            [
              'severance',
              'Severance',
              'https://uakino.best/severance.html',
              '2',
              '10',
              '1080p',
              'Inactive',
              '',
            ],
            ['invalid', '', '', '', '', '', '', ''], // Should be skipped (no title or url)
          ],
        },
      });

      const series = await service.getTrackedSeries();

      expect(series.length).toBe(2);
      expect(series[0]).toEqual({
        rowIndex: 2,
        id: 'silo',
        title: 'Таємниця бункера / Silo',
        seasonUrl: 'https://uakino.best/silo.html',
        season1Url: 'https://uakino.best/silo.html',
        lastSeason: 2,
        lastEpisode: 8,
        minQuality: '1080p',
        isActive: true,
        lastChecked: '2026-09-05 10:00',
      });
      expect(series[1].isActive).toBe(false);
    });

    it('should return empty array if spreadsheet range has no data', async () => {
      mockSheets.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [{ properties: { title: 'Series' } }],
        },
      });

      mockSheets.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [],
        },
      });

      const series = await service.getTrackedSeries();
      expect(series).toEqual([]);
    });

    it('should throw error when spreadsheet API fails', async () => {
      mockSheets.spreadsheets.get.mockRejectedValue(new Error('Permission denied'));

      await expect(service.getTrackedSeries()).rejects.toThrow('Permission denied');
    });
  });

  describe('updateSeriesState', () => {
    it('should update season, episode and last checked timestamp in Series tab', async () => {
      (service as any).resolvedSeriesTabName = 'Series';
      mockSheets.spreadsheets.values.batchUpdate.mockResolvedValue({});

      await service.updateSeriesState(2, 2, 9);

      expect(mockSheets.spreadsheets.values.batchUpdate).toHaveBeenCalledTimes(1);
      expect(mockSheets.spreadsheets.values.batchUpdate).toHaveBeenCalledWith({
        spreadsheetId: 'custom-series-sheet-id',
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: [
            {
              range: 'Series!D2:E2',
              values: [[2, 9]],
            },
            {
              range: 'Series!H2',
              values: [[expect.any(String)]],
            },
          ],
        },
      });
    });

    it('should update column C Season URL when seasonUrl is provided', async () => {
      (service as any).resolvedSeriesTabName = 'Series';
      mockSheets.spreadsheets.values.batchUpdate.mockResolvedValue({});

      await service.updateSeriesState(2, 3, 1, 'https://uakino.best/silo-s3.html');

      expect(mockSheets.spreadsheets.values.batchUpdate).toHaveBeenCalledWith({
        spreadsheetId: 'custom-series-sheet-id',
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: [
            {
              range: 'Series!C2',
              values: [['https://uakino.best/silo-s3.html']],
            },
            {
              range: 'Series!D2:E2',
              values: [[3, 1]],
            },
            {
              range: 'Series!H2',
              values: [[expect.any(String)]],
            },
          ],
        },
      });
    });
  });

  describe('updateLastChecked', () => {
    it('should update only column H for the given row index when no seasonUrl provided', async () => {
      (service as any).resolvedSeriesTabName = 'Series';
      mockSheets.spreadsheets.values.update.mockResolvedValue({});

      await service.updateLastChecked(3);

      expect(mockSheets.spreadsheets.values.update).toHaveBeenCalledWith(
        expect.objectContaining({
          spreadsheetId: 'custom-series-sheet-id',
          range: 'Series!H3',
        })
      );
    });

    it('should update column C and H via batchUpdate when seasonUrl is provided', async () => {
      (service as any).resolvedSeriesTabName = 'Series';
      mockSheets.spreadsheets.values.batchUpdate.mockResolvedValue({});

      await service.updateLastChecked(3, 'https://uakino.best/severance-s2.html');

      expect(mockSheets.spreadsheets.values.batchUpdate).toHaveBeenCalledWith({
        spreadsheetId: 'custom-series-sheet-id',
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: [
            {
              range: 'Series!C3',
              values: [['https://uakino.best/severance-s2.html']],
            },
            {
              range: 'Series!H3',
              values: [[expect.any(String)]],
            },
          ],
        },
      });
    });
  });

  describe('appendTelegramOutbox', () => {
    it('should append pending message with Toloka link and without poster to queue tab', async () => {
      mockSheets.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [{ properties: { title: 'queue' } }],
        },
      });

      mockSheets.spreadsheets.values.append.mockResolvedValue({
        data: { updates: { updatedRange: 'queue!A10:E10' } },
      });

      await service.appendTelegramOutbox(
        'Таємниця бункера / Silo',
        2,
        10,
        'silo'
      );

      expect(mockSheets.spreadsheets.values.append).toHaveBeenCalledTimes(1);
      const appendCall = mockSheets.spreadsheets.values.append.mock.calls[0][0];

      expect(appendCall.spreadsheetId).toBe('custom-outbox-sheet-id');
      expect(appendCall.range).toBe('queue!A:E');

      const row = appendCall.requestBody.values[0];
      // Row structure: [timestamp, message, chatId, parseMode, status]
      expect(row[2]).toBe('1252877');
      expect(row[3]).toBe('HTML');
      expect(row[4]).toBe('PENDING');

      // Message content checks (no poster, starts with bell announcement)
      const message = row[1];
      expect(message).not.toContain('&#8205;');
      expect(message.startsWith('🔔 <b>Вийшла нова серія</b>')).toBe(true);
      expect(message).toContain('🎬 <b>Таємниця бункера / Silo</b>');
      expect(message).toContain('📺 <b>Сезон 2, Серія 10</b>');
      expect(message).toContain('🔗 <a href="https://toloka.to/tracker.php?');
      expect(message).toContain('nm=silo&amp;pn=');
    });

    it('should format message correctly without seriesId', async () => {
      mockSheets.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [{ properties: { title: 'queue' } }],
        },
      });
      mockSheets.spreadsheets.values.append.mockResolvedValue({
        data: { updates: { updatedRange: 'queue!A11:E11' } },
      });

      await service.appendTelegramOutbox('Severance', 2, 10);

      const appendCall = mockSheets.spreadsheets.values.append.mock.calls[0][0];
      const message = appendCall.requestBody.values[0][1];

      expect(message).not.toContain('&#8205;');
      expect(message).toContain('🔔 <b>Вийшла нова серія</b>');
      expect(message).toContain('🎬 <b>Severance</b>');
    });

    it('should use cached outbox sheet name on subsequent calls', async () => {
      mockSheets.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [{ properties: { title: 'queue' } }],
        },
      });
      mockSheets.spreadsheets.values.append.mockResolvedValue({
        data: { updates: { updatedRange: 'queue!A12:E12' } },
      });

      // First call resolves and caches
      await service.appendTelegramOutbox('Silo', 2, 11);
      // Second call uses cachedOutboxSheetName without calling get again
      await service.appendTelegramOutbox('Silo', 2, 12);

      expect(mockSheets.spreadsheets.get).toHaveBeenCalledTimes(1);
    });

    it('should fallback to first sheet title or default queue when no tab matches regex', async () => {
      (service as any).cachedOutboxSheetName = null;
      mockSheets.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [{ properties: { title: 'CustomTab' } }],
        },
      });
      mockSheets.spreadsheets.values.append.mockResolvedValue({
        data: { updates: { updatedRange: 'CustomTab!A1:E1' } },
      });

      await service.appendTelegramOutbox('Test Show', 1, 1);
      const appendCall = mockSheets.spreadsheets.values.append.mock.calls[0][0];
      expect(appendCall.range).toBe('CustomTab!A:E');
    });

    it('should default to queue when resolveOutboxSheetName encounters an error', async () => {
      (service as any).cachedOutboxSheetName = null;
      mockSheets.spreadsheets.get.mockRejectedValue(new Error('Cannot read sheets'));
      mockSheets.spreadsheets.values.append.mockResolvedValue({
        data: { updates: { updatedRange: 'queue!A1:E1' } },
      });

      await service.appendTelegramOutbox('Test Show', 1, 1);
      const appendCall = mockSheets.spreadsheets.values.append.mock.calls[0][0];
      expect(appendCall.range).toBe('queue!A:E');
    });
  });

  describe('configuration and credential branches', () => {
    it('should use default spreadsheet IDs when config returns undefined', () => {
      configService.get.mockReturnValue(undefined);
      const defaultSeriesId = (service as any).getSeriesSpreadsheetId();
      const defaultOutboxId = (service as any).getOutboxSpreadsheetId();

      expect(defaultSeriesId).toBe('1TXXFR1MpAsUqcmOVRwf-2lZTPpYE3CVzCCmYuilbOLU');
      expect(defaultOutboxId).toBe('1zbsVKCvuaFgN4cbn9KNeRKSq3EOT5tsMq2yp6Mpd9dI');
    });

    it('should throw error when credentials are missing', () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'GOOGLE_SERVICE_ACCOUNT_EMAIL') return undefined;
        if (key === 'GOOGLE_PRIVATE_KEY') return undefined;
        return undefined;
      });

      expect(() => (service as any).getSheetsClient()).toThrow(
        'Google Service Account credentials missing'
      );
    });

    it('should return cached sheets client if already created', () => {
      const client1 = (service as any).getSheetsClient();
      const client2 = (service as any).getSheetsClient();
      expect(client1).toBe(client2);
    });
  });

  describe('getTrackedSeries extended branches', () => {
    it('should auto-rename C1 header from Download URL to Season URL and parse status flags', async () => {
      mockSheets.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [{ properties: { title: 'Series' } }],
        },
      });

      mockSheets.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [
            ['ID', 'Title', 'Download URL', 'Target Season', 'Last Episode', 'Min Quality', 'Status', 'Last Checked'],
            ['', 'Custom Show', 'https://uakino.best/show.html', '1', '2', '1080p', 'yes', '2026-09-01 12:00'],
            ['show-2', 'Active Show', 'https://uakino.best/show2.html', '', '', '', 'true', ''],
          ],
        },
      });
      mockSheets.spreadsheets.values.update.mockResolvedValue({});

      const series = await service.getTrackedSeries();

      expect(mockSheets.spreadsheets.values.update).toHaveBeenCalledWith({
        spreadsheetId: 'custom-series-sheet-id',
        range: 'Series!C1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['Season URL']] },
      });

      expect(series.length).toBe(2);
      // Auto-generated ID from title when ID is empty
      expect(series[0].id).toBe('custom-show');
      expect(series[0].isActive).toBe(true);
      expect(series[1].isActive).toBe(true);
      expect(series[1].lastSeason).toBe(1);
      expect(series[1].lastEpisode).toBe(0);
      expect(series[1].minQuality).toBe('1080p');
    });

    it('should handle C1 rename error gracefully', async () => {
      mockSheets.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [{ properties: { title: 'Series' } }],
        },
      });

      mockSheets.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [
            ['ID', 'Title', 'Download URL'],
            ['s1', 'Show', 'https://uakino.best/show.html', '1', '1', '1080p', '+'],
          ],
        },
      });
      mockSheets.spreadsheets.values.update.mockRejectedValue(new Error('Permission denied'));

      const series = await service.getTrackedSeries();
      expect(series.length).toBe(1);
      expect(series[0].isActive).toBe(true);
    });

    it('should fallback to first sheet tab when Series tab does not exist', async () => {
      mockSheets.spreadsheets.get.mockResolvedValue({
        data: {
          sheets: [{ properties: { title: 'Sheet1' } }],
        },
      });

      mockSheets.spreadsheets.values.get.mockResolvedValue({
        data: {
          values: [
            ['s1', 'Show', 'https://uakino.best/show.html', '1', '1', '1080p', '1'],
          ],
        },
      });

      const series = await service.getTrackedSeries();
      expect(series.length).toBe(1);
      expect((service as any).resolvedSeriesTabName).toBe('Sheet1');
    });
  });

  describe('updateLastChecked error handling', () => {
    it('should catch error and log warning when updateLastChecked fails', async () => {
      (service as any).resolvedSeriesTabName = 'Series';
      mockSheets.spreadsheets.values.update.mockRejectedValue(new Error('Network failure'));

      await expect(service.updateLastChecked(2)).resolves.not.toThrow();
    });
  });

  describe('extractEnglishTitle extended branches', () => {
    it('should handle titles with year in parentheses or non-Latin candidate', () => {
      expect(service.extractEnglishTitle('Бункер (2024)', 'silo')).toBe('silo');
      expect(service.extractEnglishTitle('Бункер', 'silo_show')).toBe('silo show');
      expect(service.extractEnglishTitle('Повільні коні')).toBe('повільні коні');
    });
  });
});

