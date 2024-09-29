import { Module } from '@nestjs/common';
import { CloudsController } from './clouds.controller';
import { CloudsService } from './clouds.service';
import { RequestsService } from 'src/requests/requests.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AsyncService } from 'src/async/async.service';

@Module({
  imports: [PrismaModule],
  controllers: [CloudsController],
  providers: [CloudsService, RequestsService, AsyncService],
})
export class CloudsModule {}
