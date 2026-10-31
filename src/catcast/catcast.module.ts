import { Module } from '@nestjs/common';
import { CatcastController } from './catcast.controller';
import { CatcastService } from './catcast.service';

@Module({
  controllers: [CatcastController],
  providers: [CatcastService],
  exports: [CatcastService],
})
export class CatcastModule {}
