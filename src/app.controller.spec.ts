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
});
