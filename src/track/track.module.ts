import { Module } from '@nestjs/common';
import { TrackService } from './track.service';
import { TrackController } from './track.controller';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { PosthogService } from 'src/posthog/posthog.service';

@Module({
  controllers: [TrackController],
  providers: [TrackService, AnalyticsService, PosthogService],
})
export class TrackModule {}
