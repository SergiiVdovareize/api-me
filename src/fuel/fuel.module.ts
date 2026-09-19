import { Module } from '@nestjs/common';
import { FuelController } from './fuel.controller';
import { FuelService } from './fuel.service';
import { RedisReader } from '../common/helpers/redisReader';

@Module({
  controllers: [FuelController],
  providers: [FuelService, RedisReader],
  exports: [FuelService],
})
export class FuelModule {}
