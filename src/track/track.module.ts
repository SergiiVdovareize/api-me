import { Module } from '@nestjs/common';
import { TrackService } from './track.service';
import { TrackController } from './track.controller';
import { PrismaModule } from 'src/models/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [TrackController],
  providers: [TrackService],
})
export class TrackModule {}
