import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SeriesTrackerModule } from '../series-tracker/series-tracker.module';
import { CnapController } from './cnap.controller';
import { CnapService } from './cnap.service';

@Module({
  imports: [ConfigModule, SeriesTrackerModule],
  controllers: [CnapController],
  providers: [CnapService],
  exports: [CnapService],
})
export class CnapModule {}
