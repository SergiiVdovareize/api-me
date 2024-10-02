import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { PosthogService } from './posthog/posthog.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly posthogService: PosthogService,
  ) {}

  @Get()
  async getHello(): Promise<string> {
    this.posthogService.trackEvent('HelloApi')
    return this.appService.getHello();
  }

  @Get('/debug-sentry')
  getError() {
    throw new Error('My first Sentry error!');
  }
}
