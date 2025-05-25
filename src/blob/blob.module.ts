import { Module } from '@nestjs/common';
import { BlobController } from './blob.controller';
import { BlobService } from './blob.service';
import { BlobReader } from 'src/common/helpers/blobReader';

@Module({
  controllers: [BlobController],
  providers: [BlobService, BlobReader],
})
export class BlobModule {}
