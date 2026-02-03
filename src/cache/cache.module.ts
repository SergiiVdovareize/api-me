import { Module } from '@nestjs/common';
import { CacheController } from './cache.controller';
import { CacheService } from './cache.service';
import { BlobService } from '../blob/blob.service';
import { RedisReader } from 'src/common/helpers/redisReader';

@Module({
  controllers: [CacheController],
  providers: [CacheService, BlobService, RedisReader],
})
export class CacheModule {}
