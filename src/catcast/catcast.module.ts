import { Module } from '@nestjs/common';
import { CatcastController } from './catcast.controller';
import { CatcastService } from './catcast.service';
import { CatcastSyncController } from './catcast-sync.controller';
import { CatcastSyncService } from './catcast-sync.service';
import { CatcastSyncGuard } from './catcast-sync.guard';
import { PrismaModule } from '../models/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CatcastController, CatcastSyncController],
  providers: [CatcastService, CatcastSyncService, CatcastSyncGuard],
  exports: [CatcastService, CatcastSyncService],
})
export class CatcastModule {}
