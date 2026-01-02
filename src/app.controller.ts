import { Controller, Get, Query } from '@nestjs/common';
import { AppService } from './app.service';
import { AnalyticsService } from './analytics/analytics.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly analyticsService: AnalyticsService
  ) {}

  @Get()
  async getHello(): Promise<string> {
    // this.analyticsService.trackEvent('HelloApi');
    return this.appService.getHello();
  }

  @Get('test')
  async test(@Query('v') v: string) {
    console.log('test', v);
    return {
      success: true,
    };
  }

  @Get('date')
  async getRandomDate(): Promise<string> {
    return this.appService.getRandomDate();
  }

  // @Get('/debug-sentry')
  // getError() {
  //   throw new Error('My first Sentry error!');
  // }
}
