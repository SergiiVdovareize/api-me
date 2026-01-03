import { Module } from '@nestjs/common';
import { CacheController } from './cache.controller';
import { CacheService } from './cache.service';
import { BlobService } from '../blob/blob.service';

@Module({
  controllers: [CacheController],
  providers: [CacheService, BlobService],
})
export class CacheModule {}
