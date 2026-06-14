import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsEvent } from './analytics.events';

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  let service: any;

  beforeEach(async () => {
    service = {
      trackEvent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [{ provide: AnalyticsService, useValue: service }],
    }).compile();

    controller = module.get<AnalyticsController>(AnalyticsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('trackEvent', () => {
    it('should track event successfully if it is a valid event', async () => {
      const result = await controller.trackEvent(AnalyticsEvent.HelloApi, { foo: 'bar' });
      expect(service.trackEvent).toHaveBeenCalledWith(AnalyticsEvent.HelloApi, { foo: 'bar' });
      expect(result).toEqual({ success: true });
    });

    it('should return error if event type is unknown', async () => {
      const result = await controller.trackEvent('InvalidEventName' as any, { foo: 'bar' });
      expect(service.trackEvent).not.toHaveBeenCalled();
      expect(result).toEqual({ success: false, message: 'unknown event type.' });
    });
  });
});
