import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PostHog } from 'posthog-node';
import { env } from 'process';

@Injectable()
export class PosthogService implements OnModuleDestroy {
  private posthog: PostHog;

  constructor() {
    this.posthog = new PostHog(env.POSTHOG_API_KEY!, {
      host: 'https://eu.i.posthog.com',
    });
  }

  /**
   * Track an event in PostHog.
   * @param event - The name of the event
   * @param properties - Additional properties for the event
   */
  trackEvent(event: string, properties: Record<string, any> = {}) {
    this.posthog.capture({
      distinctId: properties.distinctId || 'anonymous', // Replace with user id if available
      event,
      properties,
    });
  }

  /**
   * Identify a user in PostHog.
   * @param distinctId - The unique ID of the user
   * @param properties - Additional properties for the user
   */
  identifyUser(distinctId: string, properties: Record<string, any> = {}) {
    this.posthog.identify({
      distinctId,
      properties,
    });
  }

  /**
   * Clean up the PostHog client before shutdown.
   */
  onModuleDestroy() {
    this.posthog.shutdown();
  }
}
