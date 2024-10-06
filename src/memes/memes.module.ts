import { Module } from '@nestjs/common';
import { MemesController } from './memes.controller';
import { RequestsService } from 'src/requests/requests.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { MemesService } from './memes.service';
import { AsyncService } from 'src/async/async.service';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { PosthogService } from 'src/posthog/posthog.service';

@Module({
  imports: [PrismaModule],
  controllers: [MemesController],
  providers: [
    MemesService,
    RequestsService,
    AsyncService,
    AnalyticsService,
    PosthogService,
  ],
})
export class MemesModule {}
