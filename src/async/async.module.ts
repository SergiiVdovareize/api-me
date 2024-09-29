import { Module } from '@nestjs/common';
import { AsyncService } from './async.service';
import { RequestsService } from 'src/requests/requests.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AsyncController } from './async.controller';

@Module({
  imports: [PrismaModule],
  controllers: [AsyncController],
  providers: [AsyncService, RequestsService, AsyncService],
})
export class AsyncModule {}
