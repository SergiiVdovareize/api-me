import { Controller, Post, Body } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsEvent } from './analytics.events';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Post('track')
  async trackEvent(
    @Body('event') event: AnalyticsEvent,
    @Body('properties') properties: Record<string, any> = {}
  ) {
    if (!Object.values(AnalyticsEvent).includes(event)) {
      return { success: false, message: 'unknown event type.' };
    }

    this.analyticsService.trackEvent(event, properties);
    return { success: true };
  }
}
