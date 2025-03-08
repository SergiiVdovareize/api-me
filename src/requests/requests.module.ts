import { Module } from '@nestjs/common';
import { RequestsService } from './requests.service';
import { RequestsController } from './requests.controller';
import { PrismaModule } from 'src/models/prisma/prisma.module';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { PosthogService } from 'src/posthog/posthog.service';

@Module({
  controllers: [RequestsController],
  providers: [RequestsService, AnalyticsService, PosthogService],
  imports: [PrismaModule],
})
export class RequestsModule {}
