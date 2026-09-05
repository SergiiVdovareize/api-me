import { Test, TestingModule } from '@nestjs/testing';
import { SeriesTrackerService } from './series-tracker.service';
import { GoogleSheetsService } from './services/google-sheets.service';
import { UakinoParserService } from './services/uakino-parser.service';
import { TrackedSeriesItem, UakinoCheckResult } from './types';

describe('SeriesTrackerService', () => {
  let service: SeriesTrackerService;
  let googleSheetsService: {
    getTrackedSeries: jest.Mock;
    appendTelegramOutbox: jest.Mock;
    updateSeriesState: jest.Mock;
    updateLastChecked: jest.Mock;
  };
  let uakinoParserService: {
    checkSeries: jest.Mock;
  };

  beforeEach(async () => {
    googleSheetsService = {
      getTrackedSeries: jest.fn(),
      appendTelegramOutbox: jest.fn(),
      updateSeriesState: jest.fn(),
      updateLastChecked: jest.fn(),
    };

    uakinoParserService = {
      checkSeries: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SeriesTrackerService,
        { provide: GoogleSheetsService, useValue: googleSheetsService },
        { provide: UakinoParserService, useValue: uakinoParserService },
      ],
    }).compile();

    service = module.get<SeriesTrackerService>(SeriesTrackerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkAllSeries', () => {
    it('should handle empty series list', async () => {
      googleSheetsService.getTrackedSeries.mockResolvedValue([]);

      const summary = await service.checkAllSeries();

      expect(summary.checkedCount).toBe(0);
      expect(summary.notifiedCount).toBe(0);
      expect(summary.details).toEqual([]);
    });

    it('should skip inactive series', async () => {
      const inactiveItem: TrackedSeriesItem = {
        rowIndex: 2,
        id: 'severance',
        title: 'Severance',
        season1Url: 'https://uakino.best/severance.html',
        lastSeason: 2,
        lastEpisode: 10,
        minQuality: '1080p',
        isActive: false,
      };
      googleSheetsService.getTrackedSeries.mockResolvedValue([inactiveItem]);

      const summary = await service.checkAllSeries();

      expect(summary.checkedCount).toBe(1);
      expect(summary.notifiedCount).toBe(0);
      expect(summary.details[0].status).toBe('skipped');
      expect(uakinoParserService.checkSeries).not.toHaveBeenCalled();
    });

    it('should notify and update state when new episode is released', async () => {
      const item: TrackedSeriesItem = {
        rowIndex: 2,
        id: 'silo',
        title: 'Silo',
        season1Url: 'https://uakino.best/silo.html',
        lastSeason: 2,
        lastEpisode: 8,
        minQuality: '1080p',
        isActive: true,
      };
      googleSheetsService.getTrackedSeries.mockResolvedValue([item]);

      const checkResult: UakinoCheckResult = {
        latestSeason: 2,
        latestEpisode: 9,
        latestUrl: 'https://uakino.best/silo-s2.html',
        posterUrl: 'https://uakino.best/poster.jpg',
        hasConfirmedRelease: true,
      };
      uakinoParserService.checkSeries.mockResolvedValue(checkResult);

      const summary = await service.checkAllSeries();

      expect(summary.notifiedCount).toBe(1);
      expect(summary.details[0].status).toBe('notified');
      expect(googleSheetsService.appendTelegramOutbox).toHaveBeenCalledWith(
        'Silo',
        2,
        9,
        'https://uakino.best/poster.jpg',
        'silo'
      );
      expect(googleSheetsService.updateSeriesState).toHaveBeenCalledWith(2, 2, 9);
    });

    it('should notify and update state when new season is released', async () => {
      const item: TrackedSeriesItem = {
        rowIndex: 3,
        id: 'slow-horses',
        title: 'Slow Horses',
        season1Url: 'https://uakino.best/slow-horses.html',
        lastSeason: 3,
        lastEpisode: 6,
        minQuality: '1080p',
        isActive: true,
      };
      googleSheetsService.getTrackedSeries.mockResolvedValue([item]);

      const checkResult: UakinoCheckResult = {
        latestSeason: 4,
        latestEpisode: 1,
        latestUrl: 'https://uakino.best/slow-horses-s4.html',
        posterUrl: 'https://uakino.best/poster.jpg',
        hasConfirmedRelease: true,
      };
      uakinoParserService.checkSeries.mockResolvedValue(checkResult);

      const summary = await service.checkAllSeries();

      expect(summary.notifiedCount).toBe(1);
      expect(summary.details[0].status).toBe('notified');
      expect(googleSheetsService.appendTelegramOutbox).toHaveBeenCalledWith(
        'Slow Horses',
        4,
        1,
        'https://uakino.best/poster.jpg',
        'slow-horses'
      );
      expect(googleSheetsService.updateSeriesState).toHaveBeenCalledWith(3, 4, 1);
    });

    it('should update lastChecked and mark up-to-date if no new episodes', async () => {
      const item: TrackedSeriesItem = {
        rowIndex: 4,
        id: 'severance',
        title: 'Severance',
        season1Url: 'https://uakino.best/severance.html',
        lastSeason: 2,
        lastEpisode: 10,
        minQuality: '1080p',
        isActive: true,
      };
      googleSheetsService.getTrackedSeries.mockResolvedValue([item]);

      const checkResult: UakinoCheckResult = {
        latestSeason: 2,
        latestEpisode: 10,
        latestUrl: 'https://uakino.best/severance-s2.html',
        posterUrl: 'https://uakino.best/poster.jpg',
        hasConfirmedRelease: true,
      };
      uakinoParserService.checkSeries.mockResolvedValue(checkResult);

      const summary = await service.checkAllSeries();

      expect(summary.notifiedCount).toBe(0);
      expect(summary.details[0].status).toBe('up-to-date');
      expect(googleSheetsService.updateLastChecked).toHaveBeenCalledWith(4);
      expect(googleSheetsService.appendTelegramOutbox).not.toHaveBeenCalled();
      expect(googleSheetsService.updateSeriesState).not.toHaveBeenCalled();
    });

    it('should treat as up-to-date if episode is higher but hasConfirmedRelease is false', async () => {
      const item: TrackedSeriesItem = {
        rowIndex: 5,
        id: 'test',
        title: 'Test Show',
        season1Url: 'https://uakino.best/test.html',
        lastSeason: 1,
        lastEpisode: 2,
        minQuality: '1080p',
        isActive: true,
      };
      googleSheetsService.getTrackedSeries.mockResolvedValue([item]);

      const checkResult: UakinoCheckResult = {
        latestSeason: 1,
        latestEpisode: 3,
        latestUrl: 'https://uakino.best/test.html',
        hasConfirmedRelease: false,
      };
      uakinoParserService.checkSeries.mockResolvedValue(checkResult);

      const summary = await service.checkAllSeries();

      expect(summary.notifiedCount).toBe(0);
      expect(summary.details[0].status).toBe('up-to-date');
      expect(googleSheetsService.updateLastChecked).toHaveBeenCalledWith(5);
    });

    it('should catch errors from uakinoParserService and record error status without breaking loop', async () => {
      const item1: TrackedSeriesItem = {
        rowIndex: 2,
        id: 'failing',
        title: 'Failing Series',
        season1Url: 'https://uakino.best/fail.html',
        lastSeason: 1,
        lastEpisode: 1,
        minQuality: '1080p',
        isActive: true,
      };
      const item2: TrackedSeriesItem = {
        rowIndex: 3,
        id: 'ok',
        title: 'OK Series',
        season1Url: 'https://uakino.best/ok.html',
        lastSeason: 1,
        lastEpisode: 1,
        minQuality: '1080p',
        isActive: true,
      };
      googleSheetsService.getTrackedSeries.mockResolvedValue([item1, item2]);

      uakinoParserService.checkSeries
        .mockRejectedValueOnce(new Error('Cloudflare block'))
        .mockResolvedValueOnce({
          latestSeason: 1,
          latestEpisode: 1,
          latestUrl: 'https://uakino.best/ok.html',
          hasConfirmedRelease: true,
        });

      const summary = await service.checkAllSeries();

      expect(summary.checkedCount).toBe(2);
      expect(summary.details[0].status).toBe('error');
      expect(summary.details[0].error).toBe('Cloudflare block');
      expect(summary.details[1].status).toBe('up-to-date');
    });
  });
});
