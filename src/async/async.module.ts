import { Module } from '@nestjs/common';
import { AsyncService } from './async.service';
import { RequestsService } from 'src/requests/requests.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AsyncController } from './async.controller';
import { PosthogService } from 'src/posthog/posthog.service';
import { AnalyticsService } from 'src/analytics/analytics.service';

@Module({
  imports: [PrismaModule],
  controllers: [AsyncController],
  providers: [AsyncService, RequestsService, AsyncService, AnalyticsService, PosthogService],
})
export class AsyncModule {}
