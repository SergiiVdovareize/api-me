import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { PosthogService } from 'src/posthog/posthog.service';
import { AnalyticsEvent } from './analytics.events';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let posthogService: any;

  beforeEach(async () => {
    posthogService = {
      trackEvent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AnalyticsService, { provide: PosthogService, useValue: posthogService }],
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('trackEvent', () => {
    it('should forward event to posthogService.trackEvent', () => {
      service.trackEvent(AnalyticsEvent.HelloApi, { key: 'val' });
      expect(posthogService.trackEvent).toHaveBeenCalledWith(AnalyticsEvent.HelloApi, {
        key: 'val',
      });
    });
  });

  describe('trackApiEvent', () => {
    it('should append distinctId: "api-me" and forward event to trackEvent', () => {
      const spy = jest.spyOn(service, 'trackEvent');
      service.trackApiEvent(AnalyticsEvent.ApiCall, { foo: 'bar' });
      expect(spy).toHaveBeenCalledWith(AnalyticsEvent.ApiCall, {
        foo: 'bar',
        distinctId: 'api-me',
      });
    });
  });
});
