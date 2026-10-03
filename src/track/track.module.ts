import { Module } from '@nestjs/common';
import { TrackService } from './track.service';
import { TrackController } from './track.controller';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { PosthogService } from 'src/posthog/posthog.service';
import { PrismaModule } from 'src/models/prisma/prisma.module';
import { RedisReader } from 'src/common/helpers/redisReader';

@Module({
  imports: [PrismaModule],
  controllers: [TrackController],
  providers: [TrackService, AnalyticsService, PosthogService, RedisReader],
})
export class TrackModule {}
