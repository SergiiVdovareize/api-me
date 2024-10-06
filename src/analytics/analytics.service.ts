import { Injectable } from '@nestjs/common';
import { PosthogService } from 'src/posthog/posthog.service';

@Injectable()
export class AnalyticsService {
  constructor(private posthogService: PosthogService) {}

  trackEvent(event: string, properties: Record<string, any> = {}) {
    this.posthogService.trackEvent(event, properties);
  }
}
