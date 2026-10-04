import { Test, TestingModule } from '@nestjs/testing';
import { TrackController } from './track.controller';
import { TrackService } from './track.service';
import { AnalyticsService } from 'src/analytics/analytics.service';

describe('TrackController', () => {
  let controller: TrackController;
  let trackService: any;
  let analyticsService: any;

  beforeEach(async () => {
    trackService = {
      deactivateAccountByTrackId: jest.fn().mockResolvedValue(undefined),
    };
    analyticsService = {
      trackEvent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TrackController],
      providers: [
        {
          provide: TrackService,
          useValue: trackService,
        },
        {
          provide: AnalyticsService,
          useValue: analyticsService,
        },
      ],
    }).compile();

    controller = module.get<TrackController>(TrackController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('deactivate', () => {
    it('should deactivate account via POST method', async () => {
      const result = await controller.deactivate('test-track-123');
      expect(result).toEqual({ success: true });
      expect(trackService.deactivateAccountByTrackId).toHaveBeenCalledWith('test-track-123');
    });
  });
});
