import { Module } from '@nestjs/common';
import { TrackService } from './track.service';
import { TrackController } from './track.controller';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { PosthogService } from 'src/posthog/posthog.service';
import { PrismaService } from 'src/prisma.service';
import { BlobReader } from 'src/common/helpers/blobReader';
import { RedisReader } from 'src/common/helpers/redisReader';

@Module({
  controllers: [TrackController],
  providers: [
    TrackService,
    AnalyticsService,
    PosthogService,
    PrismaService,
    BlobReader,
    RedisReader,
  ],
})
export class TrackModule {}
