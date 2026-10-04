import { Module } from '@nestjs/common';
import { MemesController } from './memes.controller';
import { PrismaModule } from 'src/models/prisma/prisma.module';
import { MemesService } from './memes.service';
import {
  SnapsaveDownloader,
  MediasnapDownloader,
  NextDownloader,
  HighreachDownloader,
  VidssaveDownloader,
  VidssaveTokenParser,
} from './downloaders';

@Module({
  imports: [PrismaModule],
  controllers: [MemesController],
  providers: [
    MemesService,
    SnapsaveDownloader,
    MediasnapDownloader,
    NextDownloader,
    HighreachDownloader,
    VidssaveDownloader,
    VidssaveTokenParser,
  ],
})
export class MemesModule {}
