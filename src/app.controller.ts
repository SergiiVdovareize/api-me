import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { AnalyticsService } from './analytics/analytics.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  @Get()
  async getHello(): Promise<string> {
    this.analyticsService.trackEvent('HelloApi');
    return this.appService.getHello();
  }

  @Get('/debug-sentry')
  getError() {
    throw new Error('My first Sentry error!');
  }
}
