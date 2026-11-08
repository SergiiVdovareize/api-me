import { Module } from '@nestjs/common';
import { CatcastController } from './catcast.controller';
import { CatcastService } from './catcast.service';
import { PrismaModule } from '../models/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CatcastController],
  providers: [CatcastService],
  exports: [CatcastService],
})
export class CatcastModule {}
