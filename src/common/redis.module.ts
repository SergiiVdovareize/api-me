import { Global, Module } from '@nestjs/common';
import { RedisReader } from './helpers/redisReader';

@Global()
@Module({
  providers: [RedisReader],
  exports: [RedisReader],
})
export class RedisModule {}
