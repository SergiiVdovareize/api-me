import { Injectable } from '@nestjs/common';
import { env } from 'process';
import { PosthogService } from 'src/posthog/posthog.service';

@Injectable()
export class AnalyticsService {
  constructor(private posthogService: PosthogService) {}

  trackEvent(event: string, properties: Record<string, any> = {}, forceEnv: boolean = false) {
    console.log('env', env.HOST);
    this.posthogService.trackEvent(event, properties);
  }
}
