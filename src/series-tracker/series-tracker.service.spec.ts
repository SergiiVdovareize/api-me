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

  describe('checkSeriesReleases', () => {
    it('should check single series in round-robin order by oldest lastChecked', async () => {
      const series1: TrackedSeriesItem = {
        rowIndex: 2,
        id: 'series-recent',
        title: 'Recent Series',
        season1Url: 'https://uakino.best/recent.html',
        lastSeason: 1,
        lastEpisode: 1,
        minQuality: '1080p',
        isActive: true,
        lastChecked: '2026-09-05 23:00',
      };
      const series2: TrackedSeriesItem = {
        rowIndex: 3,
        id: 'series-never-checked',
        title: 'Never Checked Series',
        season1Url: 'https://uakino.best/never.html',
        lastSeason: 1,
        lastEpisode: 1,
        minQuality: '1080p',
        isActive: true,
        lastChecked: undefined,
      };
      const series3: TrackedSeriesItem = {
        rowIndex: 4,
        id: 'series-older',
        title: 'Older Series',
        season1Url: 'https://uakino.best/older.html',
        lastSeason: 1,
        lastEpisode: 1,
        minQuality: '1080p',
        isActive: true,
        lastChecked: '2026-09-05 20:00',
      };
      googleSheetsService.getTrackedSeries.mockResolvedValue([series1, series2, series3]);
      uakinoParserService.checkSeries.mockResolvedValue({
        latestSeason: 1,
        latestEpisode: 1,
        latestUrl: 'https://uakino.best/never.html',
        hasConfirmedRelease: true,
      });

      const summary = await service.checkSeriesReleases();

      expect(summary.checkedCount).toBe(1);
      expect(summary.totalActiveCount).toBe(3);
      expect(summary.details[0].id).toBe('series-never-checked');
      expect(summary.nextSeriesId).toBe('series-older');
      expect(uakinoParserService.checkSeries).toHaveBeenCalledTimes(1);
      expect(uakinoParserService.checkSeries).toHaveBeenCalledWith(
        'https://uakino.best/never.html',
        'Never Checked Series'
      );
    });

    it('should respect custom limit in round-robin mode', async () => {
      const series1: TrackedSeriesItem = {
        rowIndex: 2,
        id: 'series-1',
        title: 'Series 1',
        season1Url: 'https://uakino.best/1.html',
        lastSeason: 1,
        lastEpisode: 1,
        minQuality: '1080p',
        isActive: true,
        lastChecked: '2026-09-05 10:00',
      };
      const series2: TrackedSeriesItem = {
        rowIndex: 3,
        id: 'series-2',
        title: 'Series 2',
        season1Url: 'https://uakino.best/2.html',
        lastSeason: 1,
        lastEpisode: 1,
        minQuality: '1080p',
        isActive: true,
        lastChecked: '2026-09-05 12:00',
      };
      const series3: TrackedSeriesItem = {
        rowIndex: 4,
        id: 'series-3',
        title: 'Series 3',
        season1Url: 'https://uakino.best/3.html',
        lastSeason: 1,
        lastEpisode: 1,
        minQuality: '1080p',
        isActive: true,
        lastChecked: '2026-09-05 14:00',
      };
      googleSheetsService.getTrackedSeries.mockResolvedValue([series1, series2, series3]);
      uakinoParserService.checkSeries.mockResolvedValue({
        latestSeason: 1,
        latestEpisode: 1,
        latestUrl: 'https://uakino.best/1.html',
        hasConfirmedRelease: true,
      });

      const summary = await service.checkSeriesReleases({ limit: 2 });

      expect(summary.checkedCount).toBe(2);
      expect(summary.details.map(d => d.id)).toEqual(['series-1', 'series-2']);
      expect(summary.nextSeriesId).toBe('series-3');
    });

    it('should check specific series by ID', async () => {
      const series1: TrackedSeriesItem = {
        rowIndex: 2,
        id: 'severance',
        title: 'Severance',
        season1Url: 'https://uakino.best/severance.html',
        lastSeason: 2,
        lastEpisode: 10,
        minQuality: '1080p',
        isActive: true,
      };
      const series2: TrackedSeriesItem = {
        rowIndex: 3,
        id: 'silo',
        title: 'Silo',
        season1Url: 'https://uakino.best/silo.html',
        lastSeason: 2,
        lastEpisode: 8,
        minQuality: '1080p',
        isActive: true,
      };
      googleSheetsService.getTrackedSeries.mockResolvedValue([series1, series2]);
      uakinoParserService.checkSeries.mockResolvedValue({
        latestSeason: 2,
        latestEpisode: 8,
        latestUrl: 'https://uakino.best/silo.html',
        hasConfirmedRelease: true,
      });

      const summary = await service.checkSeriesReleases({ seriesId: 'silo' });

      expect(summary.checkedCount).toBe(1);
      expect(summary.details[0].id).toBe('silo');
      expect(uakinoParserService.checkSeries).toHaveBeenCalledWith(
        'https://uakino.best/silo.html',
        'Silo'
      );
    });

    it('should return empty summary if seriesId is not found', async () => {
      googleSheetsService.getTrackedSeries.mockResolvedValue([]);

      const summary = await service.checkSeriesReleases({ seriesId: 'unknown-id' });

      expect(summary.checkedCount).toBe(0);
      expect(summary.details).toEqual([]);
      expect(uakinoParserService.checkSeries).not.toHaveBeenCalled();
    });

    it('should check all series when checkAll is true', async () => {
      const series1: TrackedSeriesItem = {
        rowIndex: 2,
        id: 's1',
        title: 'Series 1',
        season1Url: 'https://uakino.best/1.html',
        lastSeason: 1,
        lastEpisode: 1,
        minQuality: '1080p',
        isActive: true,
      };
      const series2: TrackedSeriesItem = {
        rowIndex: 3,
        id: 's2',
        title: 'Series 2',
        season1Url: 'https://uakino.best/2.html',
        lastSeason: 1,
        lastEpisode: 1,
        minQuality: '1080p',
        isActive: false,
      };
      googleSheetsService.getTrackedSeries.mockResolvedValue([series1, series2]);
      uakinoParserService.checkSeries.mockResolvedValue({
        latestSeason: 1,
        latestEpisode: 1,
        latestUrl: 'https://uakino.best/1.html',
        hasConfirmedRelease: true,
      });

      const summary = await service.checkSeriesReleases({ checkAll: true });

      expect(summary.checkedCount).toBe(2);
      expect(summary.details[0].status).toBe('up-to-date');
      expect(summary.details[1].status).toBe('skipped');
    });

    it('should handle no active series gracefully in incremental mode', async () => {
      const inactive: TrackedSeriesItem = {
        rowIndex: 2,
        id: 's1',
        title: 'Series 1',
        season1Url: 'https://uakino.best/1.html',
        lastSeason: 1,
        lastEpisode: 1,
        minQuality: '1080p',
        isActive: false,
      };
      googleSheetsService.getTrackedSeries.mockResolvedValue([inactive]);

      const summary = await service.checkSeriesReleases();

      expect(summary.checkedCount).toBe(0);
      expect(summary.totalActiveCount).toBe(0);
      expect(summary.details).toEqual([]);
    });
  });
});
