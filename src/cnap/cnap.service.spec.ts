import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CnapService } from './cnap.service';
import { GoogleSheetsService } from '../series-tracker/services/google-sheets.service';
import { RedisReader } from '../common/helpers/redisReader';
import { CnapCheckResult } from './interfaces/cnap.interface';

describe('CnapService', () => {
  let service: CnapService;
  let mockGoogleSheetsService: jest.Mocked<Partial<GoogleSheetsService>>;
  let mockConfigService: jest.Mocked<Partial<ConfigService>>;
  let mockRedisReader: jest.Mocked<Partial<RedisReader>>;

  const originalFetch = global.fetch;

  beforeEach(async () => {
    mockGoogleSheetsService = {
      appendMessageToOutbox: jest.fn().mockResolvedValue(undefined),
    };

    mockConfigService = {
      get: jest.fn(),
    };

    mockRedisReader = {
      read: jest.fn().mockResolvedValue(null),
      write: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CnapService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: GoogleSheetsService, useValue: mockGoogleSheetsService },
        { provide: RedisReader, useValue: mockRedisReader },
      ],
    }).compile();

    service = module.get<CnapService>(CnapService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    global.fetch = originalFetch;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getJobsByCategory', () => {
    it('should return jobs array on success', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          isSucceeded: true,
          result: ['Послуга 1', 'Послуга 2'],
        }),
      } as any);

      const jobs = await service.getJobsByCategory('Паспортні послуги');
      expect(jobs).toEqual(['Послуга 1', 'Послуга 2']);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(
          'GetJobsByGroupName?jobGroupName=%D0%9F%D0%B0%D1%81%D0%BF%D0%BE%D1%80%D1%82%D0%BD%D1%96%20%D0%BF%D0%BE%D1%81%D0%BB%D1%83%D0%B3%D0%B8'
        )
      );
    });

    it('should throw error if fetch response is not ok', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
      } as any);

      await expect(service.getJobsByCategory('Паспортні послуги')).rejects.toThrow(
        'Failed to fetch jobs for "Паспортні послуги": HTTP 500'
      );
    });

    it('should throw error if isSucceeded is false or result is not array', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          isSucceeded: false,
          errors: ['Some error'],
        }),
      } as any);

      await expect(service.getJobsByCategory('Паспортні послуги')).rejects.toThrow(
        'CNAP API returned error or invalid format'
      );
    });
  });

  describe('getBranchesForJob', () => {
    it('should return branches array on success', async () => {
      const mockBranches = [{ guid: 'b1', name: 'Хвильового' }];
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          isSucceeded: true,
          result: mockBranches,
        }),
      } as any);

      const branches = await service.getBranchesForJob('Подати документи', 'Відстрочка');
      expect(branches).toEqual(mockBranches);
    });

    it('should throw error if fetch response is not ok', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
      } as any);

      await expect(service.getBranchesForJob('Послуга', 'Категорія')).rejects.toThrow(
        'Failed to fetch branches for "Послуга": HTTP 404'
      );
    });

    it('should throw error if isSucceeded is false or result is not array', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          isSucceeded: false,
          errors: ['Error'],
        }),
      } as any);

      await expect(service.getBranchesForJob('Послуга', 'Категорія')).rejects.toThrow(
        'CNAP API returned error or invalid format'
      );
    });
  });

  describe('parseLocations', () => {
    it('should return default locations when no location is provided', () => {
      expect(service.parseLocations()).toEqual([
        'Хвильового',
        'пл. Ринок',
        'Брюховичі',
        'Липинського',
      ]);
      expect(service.parseLocations('')).toEqual([
        'Хвильового',
        'пл. Ринок',
        'Брюховичі',
        'Липинського',
      ]);
      expect(service.parseLocations('   ')).toEqual([
        'Хвильового',
        'пл. Ринок',
        'Брюховичі',
        'Липинського',
      ]);
    });

    it('should split comma-separated locations and trim them', () => {
      expect(service.parseLocations('Хвильового, пл. Ринок , Брюховичі, Липинського')).toEqual([
        'Хвильового',
        'пл. Ринок',
        'Брюховичі',
        'Липинського',
      ]);
      expect(service.parseLocations('Хвильового')).toEqual(['Хвильового']);
    });
  });

  describe('matchesTargetLocation', () => {
    const targets = ['Хвильового', 'пл. Ринок', 'Брюховичі', 'Липинського'];

    it('should match exact and case-insensitive branch names', () => {
      expect(
        service.matchesTargetLocation('вул. Хвильового, 14а Терпідрозділ ЦНАП', targets)
      ).toBe(true);
      expect(
        service.matchesTargetLocation('с-ще Брюховичі, вул. Івасюка 2а Терпідрозділ ЦНАП', targets)
      ).toBe(true);
      expect(
        service.matchesTargetLocation(' вул. Липинського, 11 Терпідрозділ ЦНАП', targets)
      ).toBe(true);
    });

    it('should match "ЦНАП на пл.Ринок,1" without space after dot', () => {
      expect(service.matchesTargetLocation('ЦНАП на пл.Ринок,1', targets)).toBe(true);
    });

    it('should match inflected Ukrainian words like Брюховичах', () => {
      expect(
        service.matchesTargetLocation('с-ще Брюховичі, вул. Івасюка 2а', ['Брюховичах'])
      ).toBe(true);
    });

    it('should not match unrelated branches', () => {
      expect(service.matchesTargetLocation('вул. Виговського, 32', targets)).toBe(false);
      expect(service.matchesTargetLocation('с-ще Рудно вул. Грушевського, 55', targets)).toBe(false);
    });

    it('should handle empty or invalid inputs', () => {
      expect(service.matchesTargetLocation('', targets)).toBe(false);
      expect(service.matchesTargetLocation('Хвильового', [''])).toBe(false);
    });
  });

  describe('checkSlots', () => {
    it('should return empty slots when category has no available jobs', async () => {
      jest.spyOn(service, 'getJobsByCategory').mockResolvedValue([]);

      const result = await service.checkSlots({ category: 'Невідома' });

      expect(result.hasSlots).toBe(false);
      expect(result.message).toContain('наразі відсутні доступні послуги');
      expect(result.category).toBe('Невідома');
      expect(result.targetLocation).toBe('Хвильового, пл. Ринок, Брюховичі, Липинського');
    });

    it('should return message when requested service is not in available jobs', async () => {
      jest.spyOn(service, 'getJobsByCategory').mockResolvedValue(['Послуга А', 'Послуга Б']);

      const result = await service.checkSlots({
        category: 'Паспортні послуги',
        service: 'Неіснуюча послуга',
      });

      expect(result.hasSlots).toBe(false);
      expect(result.message).toContain('не знайдено серед доступних');
    });

    it('should collect available slots across multiple configured branches', async () => {
      jest.spyOn(service, 'getJobsByCategory').mockResolvedValue(['Паспортні послуги']);
      jest.spyOn(service, 'getBranchesForJob').mockResolvedValue([
        {
          guid: 'b-khv',
          name: 'вул. Хвильового, 14а Терпідрозділ ЦНАП',
          address: 'вул. Хвильового, 14а',
          freeSlots: [
            {
              workDaySlot: '2026-09-25T00:00:00+03:00',
              freeTimeSlots: ['09:00:00'],
            },
          ],
        },
        {
          guid: 'b-rynok',
          name: 'ЦНАП на пл.Ринок,1',
          address: 'пл. Ринок, 1',
          freeSlots: [
            {
              workDaySlot: '2026-09-26T00:00:00+03:00',
              freeTimeSlots: ['11:00:00', '11:30:00'],
            },
          ],
        },
        {
          guid: 'b-bryukh',
          name: 'с-ще Брюховичі, вул. Івасюка 2а Терпідрозділ ЦНАП',
          address: 'вул. Івасюка, 2а',
          freeSlots: [],
        },
        {
          guid: 'b-lyp',
          name: ' вул. Липинського, 11 Терпідрозділ ЦНАП',
          address: 'вул. Липинського, 11',
          freeSlots: [
            {
              workDaySlot: '2026-09-27T00:00:00+03:00',
              freeTimeSlots: ['15:00:00'],
            },
          ],
        },
        {
          guid: 'b-rudno',
          name: 'с-ще Рудно вул. Грушевського, 55',
          address: 'вул. Грушевського, 55',
          freeSlots: [
            {
              workDaySlot: '2026-09-25T00:00:00+03:00',
              freeTimeSlots: ['14:00:00'],
            },
          ],
        },
      ]);

      const result = await service.checkSlots({});

      expect(result.hasSlots).toBe(true);
      expect(result.targetLocation).toBe('Хвильового, пл. Ринок, Брюховичі, Липинського');
      // Should include Khvylyovoho, Rynok, Briukhovychi, Lypynskoho, but NOT Rudno
      const branches = result.services[0].branches;
      expect(branches).toHaveLength(4);
      expect(branches.map(b => b.name)).toEqual([
        'вул. Хвильового, 14а Терпідрозділ ЦНАП',
        'ЦНАП на пл.Ринок,1',
        'с-ще Брюховичі, вул. Івасюка 2а Терпідрозділ ЦНАП',
        ' вул. Липинського, 11 Терпідрозділ ЦНАП',
      ]);
      expect(branches[0].available).toBe(true);
      expect(branches[1].available).toBe(true);
      expect(branches[2].available).toBe(false);
      expect(branches[3].available).toBe(true);
    });

    it('should collect available slots and format times correctly', async () => {
      jest.spyOn(service, 'getJobsByCategory').mockResolvedValue(['Подати документи']);
      jest.spyOn(service, 'getBranchesForJob').mockResolvedValue([
        {
          guid: 'branch-1',
          name: 'вул. Хвильового, 14а Терпідрозділ ЦНАП',
          address: 'вул. Хвильового, 14а',
          freeSlots: [
            {
              workDaySlot: '2026-09-19T00:00:00+03:00',
              freeTimeSlots: ['09:00:00', '09:30:00'],
            },
            {
              // Case without 'T'
              workDaySlot: '2026-09-20',
              freeTimeSlots: ['10:00:00'],
            },
            {
              // Empty time slots (should be filtered out)
              workDaySlot: '2026-09-21',
              freeTimeSlots: [],
            },
          ],
        },
        {
          guid: 'branch-2',
          name: 'вул. Виговського, 32',
          address: 'вул. Виговського',
          freeSlots: [],
        },
      ]);

      const result = await service.checkSlots({
        category: 'Оформлення відстрочки',
        service: 'Подати документи',
        location: 'Хвильового',
      });

      expect(result.hasSlots).toBe(true);
      expect(result.message).toContain('Знайдено вільні слоти');
      expect(result.services[0].branches[0].slots).toEqual([
        { date: '2026-09-19', times: ['09:00', '09:30'] },
        { date: '2026-09-20', times: ['10:00'] },
      ]);
    });

    it('should handle branch without address (fallback to name) and without slots', async () => {
      jest.spyOn(service, 'getJobsByCategory').mockResolvedValue(['Паспортна послуга']);
      jest.spyOn(service, 'getBranchesForJob').mockResolvedValue([
        {
          guid: 'branch-1',
          name: 'вул. Хвильового, 14а',
          address: undefined, // test fallback to name
          freeSlots: [
            {
              workDaySlot: undefined, // test fallback to 'Дата'
              freeTimeSlots: ['09:00:00'],
            },
          ],
        },
      ]);

      const result = await service.checkSlots({
        category: 'Паспортні послуги',
        location: 'Хвильового',
      });

      expect(result.hasSlots).toBe(true);
      expect(result.services[0].branches[0].address).toBe('вул. Хвильового, 14а');
      expect(result.services[0].branches[0].slots[0].date).toBe('Дата');
    });

    it('should report no slots when freeSlots is empty for matched branch', async () => {
      jest.spyOn(service, 'getJobsByCategory').mockResolvedValue(['Паспорт']);
      jest.spyOn(service, 'getBranchesForJob').mockResolvedValue([
        {
          guid: 'branch-1',
          name: 'вул. Хвильового',
          freeSlots: [],
        },
      ]);

      const result = await service.checkSlots({
        location: 'Хвильового',
      });

      expect(result.hasSlots).toBe(false);
      expect(result.message).toContain(
        'Вільних місць для підрозділу на вул. Хвильового наразі немає'
      );
    });
  });

  describe('formatTelegramReport', () => {
    it('should format message when slots are available', () => {
      const checkResult: CnapCheckResult = {
        category: 'Паспортні послуги',
        targetLocation: 'Хвильового',
        hasSlots: true,
        message: 'Знайдено',
        services: [
          {
            serviceName: 'Паспорт ID',
            available: true,
            branches: [
              {
                guid: 'b1',
                name: 'Хвильового',
                address: 'Хвильового, 14а',
                available: true,
                slots: [{ date: '2026-09-19', times: ['09:00', '09:30'] }],
              },
              {
                guid: 'b2',
                name: 'Інший',
                address: 'Інший',
                available: false,
                slots: [],
              },
            ],
          },
          {
            serviceName: 'Недоступна послуга',
            available: false,
            branches: [],
          },
        ],
      };

      const report = service.formatTelegramReport(checkResult);

      expect(report).toContain('🟢 <b>ЦНАП Львів: Є вільні місця!</b>');
      expect(report).toContain('📂 Категорія: <b>Паспортні послуги</b>');
      expect(report).toContain('📋 <b>Паспорт ID</b>');
      expect(report).toContain('🏢 <b>Хвильового</b>');
      expect(report).toContain('📅 <b>2026-09-19</b>: 09:00, 09:30');
      expect(report).not.toContain('Недоступна послуга');
      expect(report).toContain(
        '🔗 <a href="https://cnap-lviv.qsolutions.com.ua:2657/booking">Перейти до запису</a>'
      );
    });

    it('should format message with multiple locations and multiple branches', () => {
      const checkResult: CnapCheckResult = {
        category: 'Паспортні послуги',
        targetLocation: 'Хвильового, пл. Ринок, Брюховичі',
        hasSlots: true,
        message: 'Знайдено',
        services: [
          {
            serviceName: 'Паспорт громадянина України',
            available: true,
            branches: [
              {
                guid: 'b1',
                name: 'ЦНАП на пл.Ринок,1',
                address: 'пл. Ринок, 1',
                available: true,
                slots: [{ date: '2026-09-24', times: ['14:00'] }],
              },
            ],
          },
        ],
      };

      const report = service.formatTelegramReport(checkResult);

      expect(report).toContain('🏢 Локації: <b>Хвильового, пл. Ринок, Брюховичі</b>');
      expect(report).toContain('🏢 <b>ЦНАП на пл.Ринок,1</b>');
      expect(report).toContain('📅 <b>2026-09-24</b>: 14:00');
    });

    it('should format message when slots are not available', () => {
      const checkResult: CnapCheckResult = {
        category: 'Паспортні послуги',
        targetLocation: 'Хвильового',
        hasSlots: false,
        message: 'Місць немає',
        services: [],
      };

      const report = service.formatTelegramReport(checkResult);

      expect(report).toContain('🔴 <b>ЦНАП Львів: Вільних місць немає</b>');
      expect(report).toContain('📂 Категорія: <b>Паспортні послуги</b>');
      expect(report).toContain('<i>Місць немає</i>');
      expect(report).toContain(
        '🔗 <a href="https://cnap-lviv.qsolutions.com.ua:2657/booking">Онлайн-запис ЦНАП</a>'
      );
    });
  });

  describe('getKyivHour', () => {
    it('should return number between 0 and 23', () => {
      const hour = service.getKyivHour();
      expect(typeof hour).toBe('number');
      expect(hour).toBeGreaterThanOrEqual(0);
      expect(hour).toBeLessThanOrEqual(23);
    });

    it('should handle fallback when Intl throws error', () => {
      const originalIntl = global.Intl;
      try {
        (global as any).Intl = {
          DateTimeFormat: jest.fn().mockImplementation(() => {
            throw new Error('Intl unsupported');
          }),
        };

        const testDate = new Date('2026-09-18T10:00:00Z'); // UTC 10, UTC+3 = 13
        const hour = service.getKyivHour(testDate);
        expect(hour).toBe(13);
      } finally {
        global.Intl = originalIntl;
      }
    });
  });

  describe('getKyivDateString', () => {
    it('should return date string in YYYY-MM-DD format', () => {
      const dateStr = service.getKyivDateString();
      expect(dateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should handle fallback when Intl throws error', () => {
      const originalIntl = global.Intl;
      try {
        (global as any).Intl = {
          DateTimeFormat: jest.fn().mockImplementation(() => {
            throw new Error('Intl unsupported');
          }),
        };

        const testDate = new Date('2026-09-18T10:00:00Z');
        const dateStr = service.getKyivDateString(testDate);
        expect(dateStr).toBe('2026-09-18');
      } finally {
        global.Intl = originalIntl;
      }
    });
  });

  describe('checkAndNotify', () => {
    it('should not notify when notify is false or "false"', async () => {
      jest.spyOn(service, 'checkSlots').mockResolvedValue({
        category: 'Паспортні послуги',
        targetLocation: 'Хвильового',
        hasSlots: true,
        services: [],
        message: 'Знайдено',
      });

      const response = await service.checkAndNotify({ notify: false });

      expect(response.telegramQueued).toBe(false);
      expect(response.telegramSkipReason).toContain('Сповіщення вимкнено');
      expect(mockGoogleSheetsService.appendMessageToOutbox).not.toHaveBeenCalled();

      const responseString = await service.checkAndNotify({ notify: 'false' });
      expect(responseString.telegramQueued).toBe(false);
      expect(mockGoogleSheetsService.appendMessageToOutbox).not.toHaveBeenCalled();
    });

    it('should always notify when hasSlots is true', async () => {
      jest.spyOn(service, 'checkSlots').mockResolvedValue({
        category: 'Відстрочка',
        targetLocation: 'Хвильового',
        hasSlots: true,
        services: [],
        message: 'Є місця',
      });
      jest.spyOn(service, 'getKyivHour').mockReturnValue(9);
      jest.spyOn(service, 'getKyivDateString').mockReturnValue('2026-09-23');

      const response = await service.checkAndNotify({ chatId: '999' });

      expect(response.telegramQueued).toBe(true);
      expect(mockGoogleSheetsService.appendMessageToOutbox).toHaveBeenCalledWith(
        expect.stringContaining('🟢 <b>ЦНАП Львів: Є вільні місця!</b>'),
        '999'
      );
      expect(mockRedisReader.write).toHaveBeenCalledWith('cnap:last_heartbeat_date', '2026-09-23');
    });

    it('should handle error when appendMessageToOutbox throws on slots available', async () => {
      jest.spyOn(service, 'checkSlots').mockResolvedValue({
        category: 'Відстрочка',
        targetLocation: 'Хвильового',
        hasSlots: true,
        services: [],
        message: 'Є місця',
      });

      mockGoogleSheetsService.appendMessageToOutbox.mockRejectedValue(new Error('Sheets API down'));

      const response = await service.checkAndNotify({});

      expect(response.telegramQueued).toBe(false);
      expect(mockGoogleSheetsService.appendMessageToOutbox).toHaveBeenCalled();
    });

    it('should notify when no slots if force is true or notify is "always" or "force"', async () => {
      jest.spyOn(service, 'checkSlots').mockResolvedValue({
        category: 'Паспортні послуги',
        targetLocation: 'Хвильового',
        hasSlots: false,
        services: [],
        message: 'Немає місць',
      });
      jest.spyOn(service, 'getKyivHour').mockReturnValue(8); // before 9am

      const responseForce = await service.checkAndNotify({ force: true });
      expect(responseForce.telegramQueued).toBe(true);
      expect(mockGoogleSheetsService.appendMessageToOutbox).toHaveBeenCalled();

      mockGoogleSheetsService.appendMessageToOutbox.mockClear();

      const responseAlways = await service.checkAndNotify({ notify: 'always' });
      expect(responseAlways.telegramQueued).toBe(true);
      expect(mockGoogleSheetsService.appendMessageToOutbox).toHaveBeenCalled();

      mockGoogleSheetsService.appendMessageToOutbox.mockClear();

      const responseForceStr = await service.checkAndNotify({ force: 'true' });
      expect(responseForceStr.telegramQueued).toBe(true);
      expect(mockGoogleSheetsService.appendMessageToOutbox).toHaveBeenCalled();
    });

    it('should send heartbeat notification on first search after 9am when no slots', async () => {
      jest.spyOn(service, 'checkSlots').mockResolvedValue({
        category: 'Паспортні послуги',
        targetLocation: 'Хвильового',
        hasSlots: false,
        services: [],
        message: 'Немає місць',
      });
      jest.spyOn(service, 'getKyivHour').mockReturnValue(9);
      jest.spyOn(service, 'getKyivDateString').mockReturnValue('2026-09-23');
      mockRedisReader.read.mockResolvedValue(null);

      const response = await service.checkAndNotify({});

      expect(response.telegramQueued).toBe(true);
      expect(response.report).toBe(
        'ℹ️ <b>ЦНАП Львів: Моніторинг працює</b>\n\nПеревірка виконана успішно. Автоматичний моніторинг активний.'
      );
      expect(mockGoogleSheetsService.appendMessageToOutbox).toHaveBeenCalledWith(
        'ℹ️ <b>ЦНАП Львів: Моніторинг працює</b>\n\nПеревірка виконана успішно. Автоматичний моніторинг активний.',
        undefined
      );
      expect(mockRedisReader.write).toHaveBeenCalledWith('cnap:last_heartbeat_date', '2026-09-23');
    });

    it('should skip notification on second search after 9am on same day when no slots', async () => {
      jest.spyOn(service, 'checkSlots').mockResolvedValue({
        category: 'Паспортні послуги',
        targetLocation: 'Хвильового',
        hasSlots: false,
        services: [],
        message: 'Немає місць',
      });
      jest.spyOn(service, 'getKyivHour').mockReturnValue(11);
      jest.spyOn(service, 'getKyivDateString').mockReturnValue('2026-09-23');
      mockRedisReader.read.mockResolvedValue('2026-09-23');

      const response = await service.checkAndNotify({});

      expect(response.telegramQueued).toBe(false);
      expect(response.telegramSkipReason).toBe('Вільних місць немає. Сповіщення не надсилається.');
      expect(mockGoogleSheetsService.appendMessageToOutbox).not.toHaveBeenCalled();
    });

    it('should skip notification when search is before 9am and no slots', async () => {
      jest.spyOn(service, 'checkSlots').mockResolvedValue({
        category: 'Паспортні послуги',
        targetLocation: 'Хвильового',
        hasSlots: false,
        services: [],
        message: 'Немає місць',
      });
      jest.spyOn(service, 'getKyivHour').mockReturnValue(8);
      jest.spyOn(service, 'getKyivDateString').mockReturnValue('2026-09-23');
      mockRedisReader.read.mockResolvedValue(null);

      const response = await service.checkAndNotify({});

      expect(response.telegramQueued).toBe(false);
      expect(response.telegramSkipReason).toBe('Вільних місць немає. Сповіщення не надсилається.');
      expect(mockGoogleSheetsService.appendMessageToOutbox).not.toHaveBeenCalled();
    });

    it('should handle error when appendMessageToOutbox fails during heartbeat notification', async () => {
      jest.spyOn(service, 'checkSlots').mockResolvedValue({
        category: 'Паспортні послуги',
        targetLocation: 'Хвильового',
        hasSlots: false,
        services: [],
        message: 'Немає місць',
      });
      jest.spyOn(service, 'getKyivHour').mockReturnValue(9);
      jest.spyOn(service, 'getKyivDateString').mockReturnValue('2026-09-23');
      mockRedisReader.read.mockResolvedValue(null);
      mockGoogleSheetsService.appendMessageToOutbox.mockRejectedValue(
        new Error('Sheet write failed')
      );

      const response = await service.checkAndNotify({});

      expect(response.telegramQueued).toBe(false);
      expect(mockGoogleSheetsService.appendMessageToOutbox).toHaveBeenCalled();
    });

    it('should handle error when appendMessageToOutbox fails during force notification', async () => {
      jest.spyOn(service, 'checkSlots').mockResolvedValue({
        category: 'Паспортні послуги',
        targetLocation: 'Хвильового',
        hasSlots: false,
        services: [],
        message: 'Немає місць',
      });
      jest.spyOn(service, 'getKyivHour').mockReturnValue(8);
      mockGoogleSheetsService.appendMessageToOutbox.mockRejectedValue(
        new Error('Sheet write failed')
      );

      const response = await service.checkAndNotify({ force: true });

      expect(response.telegramQueued).toBe(false);
      expect(mockGoogleSheetsService.appendMessageToOutbox).toHaveBeenCalled();
    });
  });
});
