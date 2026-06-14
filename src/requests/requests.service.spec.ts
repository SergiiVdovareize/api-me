import { Test, TestingModule } from '@nestjs/testing';
import { RequestsService } from './requests.service';
import { PrismaService } from 'src/models/prisma/prisma.service';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { AnalyticsEvent } from 'src/analytics/analytics.events';

describe('RequestsService', () => {
  let service: RequestsService;
  let prisma: any;
  let analyticsService: any;

  beforeEach(async () => {
    prisma = {
      request: {
        create: jest.fn(),
        count: jest.fn(),
      },
    };
    analyticsService = {
      trackEvent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequestsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AnalyticsService, useValue: analyticsService },
      ],
    }).compile();

    service = module.get<RequestsService>(RequestsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getDateMonthAgo', () => {
    it('should return a date approximately 31 days in the past', () => {
      const date = service.getDateMonthAgo();
      expect(date).toBeInstanceOf(Date);
      const diffTime = Date.now() - date.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      // Should be around 31 days
      expect(diffDays).toBeGreaterThanOrEqual(30);
      expect(diffDays).toBeLessThanOrEqual(32);
    });
  });

  describe('register API calls', () => {
    it('should register plain API calls', async () => {
      prisma.request.create.mockResolvedValue({ id: 1 });
      await service.registerPlainApiCall();
      expect(analyticsService.trackEvent).toHaveBeenCalledWith(AnalyticsEvent.ApiCall, {
        apiType: 0,
      });
      expect(prisma.request.create).toHaveBeenCalledWith({ data: { apiType: 0 } });
    });

    it('should register Fibonacci API calls', async () => {
      await service.registerFibonacciApiCall();
      expect(analyticsService.trackEvent).toHaveBeenCalledWith(AnalyticsEvent.ApiCall, {
        apiType: 1,
      });
    });

    it('should register Prime API calls', async () => {
      await service.registerPrimeApiCall();
      expect(analyticsService.trackEvent).toHaveBeenCalledWith(AnalyticsEvent.ApiCall, {
        apiType: 2,
      });
    });

    it('should register Armstrong API calls', async () => {
      await service.registerArmstrongApiCall();
      expect(analyticsService.trackEvent).toHaveBeenCalledWith(AnalyticsEvent.ApiCall, {
        apiType: 3,
      });
    });

    describe('registerMemeApiCall', () => {
      it('should identify youtube links', async () => {
        await service.registerMemeApiCall('https://youtube.com/watch?v=123');
        expect(analyticsService.trackEvent).toHaveBeenCalledWith(AnalyticsEvent.ApiCall, {
          apiType: 12,
        });
      });

      it('should identify twitter / x links', async () => {
        await service.registerMemeApiCall('https://x.com/user/status/123');
        expect(analyticsService.trackEvent).toHaveBeenCalledWith(AnalyticsEvent.ApiCall, {
          apiType: 11,
        });
      });

      it('should identify instagram links', async () => {
        await service.registerMemeApiCall('https://instagram.com/p/123');
        expect(analyticsService.trackEvent).toHaveBeenCalledWith(AnalyticsEvent.ApiCall, {
          apiType: 10,
        });
      });

      it('should identify facebook links', async () => {
        await service.registerMemeApiCall('https://facebook.com/watch?v=123');
        expect(analyticsService.trackEvent).toHaveBeenCalledWith(AnalyticsEvent.ApiCall, {
          apiType: 13,
        });
      });

      it('should identify tiktok links', async () => {
        await service.registerMemeApiCall('https://tiktok.com/@user/video/123');
        expect(analyticsService.trackEvent).toHaveBeenCalledWith(AnalyticsEvent.ApiCall, {
          apiType: 14,
        });
      });

      it('should identify linkedin links', async () => {
        await service.registerMemeApiCall('https://linkedin.com/posts/xyz');
        expect(analyticsService.trackEvent).toHaveBeenCalledWith(AnalyticsEvent.ApiCall, {
          apiType: 15,
        });
      });

      it('should identify threads links', async () => {
        await service.registerMemeApiCall('https://threads.com/post/xyz');
        expect(analyticsService.trackEvent).toHaveBeenCalledWith(AnalyticsEvent.ApiCall, {
          apiType: 16,
        });
      });

      it('should fallback to unknown meme key if domain is unsupported', async () => {
        await service.registerMemeApiCall('https://unsupported-site.com/media');
        expect(analyticsService.trackEvent).toHaveBeenCalledWith(AnalyticsEvent.ApiCall, {
          apiType: 39,
        });
      });
    });
  });

  describe('counters', () => {
    it('countAll should call prisma.request.count', async () => {
      prisma.request.count.mockResolvedValue(10);
      const result = await service.countAll();
      expect(prisma.request.count).toHaveBeenCalled();
      expect(result).toBe(10);
    });

    it('countType should count by type', async () => {
      prisma.request.count.mockResolvedValue(5);
      const result = await service.countType(10);
      expect(prisma.request.count).toHaveBeenCalledWith({ where: { apiType: 10 } });
      expect(result).toBe(5);
    });

    it('countAllThisMonth should count within date month ago range', async () => {
      prisma.request.count.mockResolvedValue(8);
      const result = await service.countAllThisMonth();
      expect(prisma.request.count).toHaveBeenCalledWith({
        where: {
          createdAt: {
            gte: expect.any(Date),
          },
        },
      });
      expect(result).toBe(8);
    });

    it('countTypeThisMonth should count by type within month range', async () => {
      prisma.request.count.mockResolvedValue(3);
      const result = await service.countTypeThisMonth(2);
      expect(prisma.request.count).toHaveBeenCalledWith({
        where: {
          apiType: 2,
          createdAt: {
            gte: expect.any(Date),
          },
        },
      });
      expect(result).toBe(3);
    });

    it('countFibonacciThisMonth should query correct type', async () => {
      const spy = jest.spyOn(service, 'countTypeThisMonth').mockResolvedValue(12);
      const result = await service.countFibonacciThisMonth();
      expect(spy).toHaveBeenCalledWith(1);
      expect(result).toBe(12);
    });

    it('countPrimeThisMonth should query correct type', async () => {
      const spy = jest.spyOn(service, 'countTypeThisMonth').mockResolvedValue(15);
      const result = await service.countPrimeThisMonth();
      expect(spy).toHaveBeenCalledWith(2);
      expect(result).toBe(15);
    });

    it('countArmstrongThisMonth should query correct type', async () => {
      const spy = jest.spyOn(service, 'countTypeThisMonth').mockResolvedValue(7);
      const result = await service.countArmstrongThisMonth();
      expect(spy).toHaveBeenCalledWith(3);
      expect(result).toBe(7);
    });
  });
});
