import { Module } from '@nestjs/common';
import { MemesController } from './memes.controller';
import { PrismaModule } from 'src/models/prisma/prisma.module';
import { MemesService } from './memes.service';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { PosthogService } from 'src/posthog/posthog.service';
import {
  SnapsaveDownloader,
  MediasnapDownloader,
  NextDownloader,
  HighreachDownloader,
  VidssaveDownloader,
} from './downloaders';

@Module({
  imports: [PrismaModule],
  controllers: [MemesController],
  providers: [
    MemesService,
    AnalyticsService,
    PosthogService,
    SnapsaveDownloader,
    MediasnapDownloader,
    NextDownloader,
    HighreachDownloader,
    VidssaveDownloader,
  ],
})
export class MemesModule {}
