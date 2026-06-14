import { Test, TestingModule } from '@nestjs/testing';
import { PosthogService } from './posthog.service';
import { PostHog } from 'posthog-node';
import { env } from 'process';
import { AnalyticsEvent } from 'src/analytics/analytics.events';
import { ConfigService } from '@nestjs/config';

const mockPostHogInstance = {
  capture: jest.fn(),
  identify: jest.fn(),
  shutdown: jest.fn(),
};

jest.mock('posthog-node', () => {
  return {
    PostHog: jest.fn().mockImplementation(() => mockPostHogInstance),
  };
});

describe('PosthogService', () => {
  let originalNodeEnv: string;
  let originalHost: string;
  let originalPosthogApiKey: string;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    originalHost = env.HOST;
    originalPosthogApiKey = env.POSTHOG_API_KEY;
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    env.HOST = originalHost;
    env.POSTHOG_API_KEY = originalPosthogApiKey;
  });

  describe('When in test / local environment (no PostHog client)', () => {
    let service: PosthogService;

    beforeEach(async () => {
      // Keep env as test
      process.env.NODE_ENV = 'test';

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PosthogService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockImplementation((key: string) => {
                if (key === 'NODE_ENV') return process.env.NODE_ENV;
                if (key === 'HOST') return env.HOST;
                if (key === 'POSTHOG_API_KEY') return env.POSTHOG_API_KEY;
                return undefined;
              }),
            },
          },
        ],
      }).compile();

      service = module.get<PosthogService>(PosthogService);
    });

    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('trackEvent should return early and not call capture', () => {
      service.trackEvent(AnalyticsEvent.HelloApi, { foo: 'bar' });
      expect(mockPostHogInstance.capture).not.toHaveBeenCalled();
    });

    it('identifyUser should return early and not call identify', () => {
      service.identifyUser('user-1', { email: 'user@example.com' });
      expect(mockPostHogInstance.identify).not.toHaveBeenCalled();
    });

    it('onModuleDestroy should not call shutdown', () => {
      expect(() => service.onModuleDestroy()).not.toThrow();
      expect(mockPostHogInstance.shutdown).not.toHaveBeenCalled();
    });
  });

  describe('When in production environment (with PostHog client)', () => {
    let service: PosthogService;

    beforeEach(async () => {
      process.env.NODE_ENV = 'production';
      env.HOST = 'prod';
      env.POSTHOG_API_KEY = 'prod-key-123';

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          PosthogService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockImplementation((key: string) => {
                if (key === 'NODE_ENV') return process.env.NODE_ENV;
                if (key === 'HOST') return env.HOST;
                if (key === 'POSTHOG_API_KEY') return env.POSTHOG_API_KEY;
                return undefined;
              }),
            },
          },
        ],
      }).compile();

      service = module.get<PosthogService>(PosthogService);
    });

    it('should initialize PostHog client', () => {
      expect(PostHog).toHaveBeenCalledWith('prod-key-123', {
        host: 'https://eu.i.posthog.com',
      });
    });

    it('trackEvent should call capture', () => {
      service.trackEvent(AnalyticsEvent.HelloApi, { foo: 'bar', distinctId: 'custom-id' });
      expect(mockPostHogInstance.capture).toHaveBeenCalledWith({
        distinctId: 'custom-id',
        event: AnalyticsEvent.HelloApi,
        properties: {
          foo: 'bar',
          distinctId: 'custom-id',
          env: 'prod',
        },
      });
    });

    it('trackEvent should fallback to anonymous distinctId', () => {
      service.trackEvent(AnalyticsEvent.HelloApi, { foo: 'bar' });
      expect(mockPostHogInstance.capture).toHaveBeenCalledWith({
        distinctId: 'anonymous',
        event: AnalyticsEvent.HelloApi,
        properties: {
          foo: 'bar',
          env: 'prod',
        },
      });
    });

    it('identifyUser should call identify', () => {
      service.identifyUser('user-1', { email: 'user@example.com' });
      expect(mockPostHogInstance.identify).toHaveBeenCalledWith({
        distinctId: 'user-1',
        properties: { email: 'user@example.com' },
      });
    });

    it('onModuleDestroy should call shutdown', () => {
      service.onModuleDestroy();
      expect(mockPostHogInstance.shutdown).toHaveBeenCalled();
    });
  });
});
