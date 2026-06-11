import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AnalyticsService } from 'src/analytics/analytics.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AppService,
          useValue: {
            getHello: () => 'Hello mr. Bob!',
          },
        },
        {
          provide: AnalyticsService,
          useValue: {},
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello mr. Bob!"', async () => {
      expect(await appController.getHello()).toBe('Hello mr. Bob!');
    });
  });

  describe('download', () => {
    it('should throw an error if URL parameter is missing', async () => {
      const mockResponse = {
        redirect: jest.fn(),
      } as any;

      await expect(appController.download('', mockResponse)).rejects.toThrow(
        expect.objectContaining({
          message: 'Missing url parameter',
          status: 400,
        })
      );
    });

    it('should redirect if URL is a googlevideo link', async () => {
      const mockResponse = {
        redirect: jest.fn(),
      } as any;

      const targetUrl = 'https://rr2---sn-uxoxu05-vqnz.googlevideo.com/videoplayback?expire=123';
      const result = await appController.download(targetUrl, mockResponse);

      expect(result).toBeUndefined();
      expect(mockResponse.redirect).toHaveBeenCalledWith(targetUrl);
    });

    it('should redirect as a fallback if the fetch returns 403 Forbidden', async () => {
      const mockResponse = {
        redirect: jest.fn(),
      } as any;

      const targetUrl = 'https://somecdn.com/file.mp4';

      // Mock global fetch
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      });

      try {
        const result = await appController.download(targetUrl, mockResponse);
        expect(result).toBeUndefined();
        expect(mockResponse.redirect).toHaveBeenCalledWith(targetUrl);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
