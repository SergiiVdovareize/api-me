import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SeriesTrackerModule } from '../series-tracker/series-tracker.module';
import { CnapController } from './cnap.controller';
import { CnapService } from './cnap.service';
import { RedisReader } from '../common/helpers/redisReader';

@Module({
  imports: [ConfigModule, SeriesTrackerModule],
  controllers: [CnapController],
  providers: [CnapService, RedisReader],
  exports: [CnapService],
})
export class CnapModule {}
