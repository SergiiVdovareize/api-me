import { Injectable } from '@nestjs/common';
import { env } from 'process';
import { PosthogService } from 'src/posthog/posthog.service';

@Injectable()
export class AnalyticsService {
  constructor(private posthogService: PosthogService) {}

  trackEvent(event: string, properties: Record<string, any> = {}, forceEnv: boolean = false) {
    if (env.HOST !== 'prod' && !forceEnv) {
      console.log('event filtered', env.HOST)
      return;
    }

    console.log('event tracked', event)
    this.posthogService.trackEvent(event, properties);
  }
}
