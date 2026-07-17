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
  VidssaveTokenParser,
} from './downloaders';
import { BlobService } from 'src/blob/blob.service';

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
    VidssaveTokenParser,
    BlobService,
  ],
})
export class MemesModule {}
