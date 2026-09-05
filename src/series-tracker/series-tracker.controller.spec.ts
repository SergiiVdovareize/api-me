import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { SeriesTrackerController } from './series-tracker.controller';
import { SeriesTrackerService } from './series-tracker.service';
import { GoogleSheetsService } from './services/google-sheets.service';
import { SeriesCheckSummary, TrackedSeriesItem } from './types';

describe('SeriesTrackerController', () => {
  let controller: SeriesTrackerController;
  let seriesTrackerService: { checkAllSeries: jest.Mock; checkSeriesReleases: jest.Mock };
  let googleSheetsService: { getTrackedSeries: jest.Mock };
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    seriesTrackerService = {
      checkAllSeries: jest.fn(),
      checkSeriesReleases: jest.fn(),
    };

    googleSheetsService = {
      getTrackedSeries: jest.fn(),
    };

    configService = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SeriesTrackerController],
      providers: [
        { provide: SeriesTrackerService, useValue: seriesTrackerService },
        { provide: GoogleSheetsService, useValue: googleSheetsService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    controller = module.get<SeriesTrackerController>(SeriesTrackerController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('security / validateToken', () => {
    it('should allow request if no secret is configured', async () => {
      configService.get.mockReturnValue(undefined);
      seriesTrackerService.checkSeriesReleases.mockResolvedValue({
        checkedCount: 0,
        notifiedCount: 0,
        timestamp: '2026-09-05T00:00:00.000Z',
        details: [],
      });

      const result = await controller.checkViaGet();
      expect(result.checkedCount).toBe(0);
    });

    it('should validate token from query param against CRON_SECRET', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'CRON_SECRET') return 'my-cron-secret';
        return undefined;
      });
      seriesTrackerService.checkSeriesReleases.mockResolvedValue({
        checkedCount: 1,
        notifiedCount: 0,
        timestamp: '2026-09-05T00:00:00.000Z',
        details: [],
      });

      const result = await controller.checkViaGet('my-cron-secret');
      expect(result.checkedCount).toBe(1);
    });

    it('should validate bearer token from authorization header against SERIES_TRACKER_SECRET', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'SERIES_TRACKER_SECRET') return 'tracker-secret-123';
        return undefined;
      });
      seriesTrackerService.checkSeriesReleases.mockResolvedValue({
        checkedCount: 1,
        notifiedCount: 1,
        timestamp: '2026-09-05T00:00:00.000Z',
        details: [],
      });

      const result = await controller.checkViaPost(undefined, 'Bearer tracker-secret-123');
      expect(result.notifiedCount).toBe(1);
    });

    it('should throw UnauthorizedException on invalid token', async () => {
      configService.get.mockReturnValue('expected-secret');

      await expect(controller.checkViaGet('wrong-token')).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException on missing token', async () => {
      configService.get.mockReturnValue('expected-secret');

      await expect(controller.checkViaPost(undefined, undefined)).rejects.toThrow(
        UnauthorizedException
      );
    });
  });

  describe('checkViaGet', () => {
    it('should call seriesTrackerService.checkSeriesReleases with parsed options', async () => {
      configService.get.mockReturnValue(undefined);
      const mockSummary: SeriesCheckSummary = {
        checkedCount: 1,
        notifiedCount: 1,
        timestamp: '2026-09-05T12:00:00.000Z',
        details: [],
      };
      seriesTrackerService.checkSeriesReleases.mockResolvedValue(mockSummary);

      const res = await controller.checkViaGet(undefined, undefined, 'silo', '2', 'true');
      expect(res).toEqual(mockSummary);
      expect(seriesTrackerService.checkSeriesReleases).toHaveBeenCalledWith({
        seriesId: 'silo',
        limit: 2,
        checkAll: true,
      });
    });
  });

  describe('checkViaPost', () => {
    it('should call seriesTrackerService.checkSeriesReleases with default options', async () => {
      configService.get.mockReturnValue(undefined);
      const mockSummary: SeriesCheckSummary = {
        checkedCount: 1,
        notifiedCount: 0,
        timestamp: '2026-09-05T12:00:00.000Z',
        details: [],
      };
      seriesTrackerService.checkSeriesReleases.mockResolvedValue(mockSummary);

      const res = await controller.checkViaPost();
      expect(res).toEqual(mockSummary);
      expect(seriesTrackerService.checkSeriesReleases).toHaveBeenCalledWith({
        seriesId: undefined,
        limit: undefined,
        checkAll: false,
      });
    });
  });

  describe('listTracked', () => {
    it('should return tracked series list from google sheets', async () => {
      configService.get.mockReturnValue(undefined);
      const mockItems: TrackedSeriesItem[] = [
        {
          rowIndex: 2,
          id: 'silo',
          title: 'Таємниця бункера / Silo',
          season1Url: 'https://uakino.best/silo.html',
          lastSeason: 2,
          lastEpisode: 10,
          minQuality: '1080p',
          isActive: true,
        },
      ];
      googleSheetsService.getTrackedSeries.mockResolvedValue(mockItems);

      const res = await controller.listTracked();
      expect(res).toEqual(mockItems);
    });

    it('should catch errors in listTracked and return error object', async () => {
      configService.get.mockReturnValue(undefined);
      googleSheetsService.getTrackedSeries.mockRejectedValue(new Error('Sheet not accessible'));

      const res = await controller.listTracked();
      expect(res).toEqual({
        success: false,
        error: 'Sheet not accessible',
      });
    });
  });
});
