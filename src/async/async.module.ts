import { Module } from '@nestjs/common';
import { AsyncService } from './async.service';
import { PrismaModule } from 'src/models/prisma/prisma.module';
import { AsyncController } from './async.controller';
import { RequestsModule } from 'src/requests/requests.module';

@Module({
  imports: [PrismaModule, RequestsModule],
  controllers: [AsyncController],
  providers: [AsyncService],
  exports: [AsyncService],
})
export class AsyncModule {}
