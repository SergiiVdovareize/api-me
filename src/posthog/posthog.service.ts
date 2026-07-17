import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostHog } from 'posthog-node';
import { AnalyticsEvent } from 'src/analytics/analytics.events';

@Injectable()
export class PosthogService implements OnModuleDestroy {
  private posthog: PostHog;

  constructor(private readonly configService: ConfigService) {
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    const host = this.configService.get<string>('HOST');
    const apiKey = this.configService.get<string>('POSTHOG_API_KEY');

    if (nodeEnv !== 'test' && host !== 'local') {
      this.posthog = new PostHog(apiKey!, {
        host: 'https://eu.i.posthog.com',
      });
    }
  }

  /**
   * Track an event in PostHog.
   * @param event - The name of the event
   * @param properties - Additional properties for the event
   */
  trackEvent(event: AnalyticsEvent, properties: Record<string, any> = {}) {
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    const host = this.configService.get<string>('HOST');
    if (nodeEnv === 'test' || host === 'local' || !this.posthog) {
      return;
    }
    this.posthog.capture({
      distinctId: properties.distinctId || 'anonymous', // Replace with user id if available
      event,
      properties: {
        ...properties,
        env: host,
      },
    });
  }

  /**
   * Identify a user in PostHog.
   * @param distinctId - The unique ID of the user
   * @param properties - Additional properties for the user
   */
  identifyUser(distinctId: string, properties: Record<string, any> = {}) {
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    const host = this.configService.get<string>('HOST');
    if (nodeEnv === 'test' || host === 'local' || !this.posthog) {
      return;
    }
    this.posthog.identify({
      distinctId,
      properties,
    });
  }

  /**
   * Clean up the PostHog client before shutdown.
   */
  onModuleDestroy() {
    if (this.posthog) {
      this.posthog.shutdown();
    }
  }
}
