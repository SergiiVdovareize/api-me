import { Module } from '@nestjs/common';
import { CloudsController } from './clouds.controller';
import { CloudsService } from './clouds.service';
import { PrismaModule } from 'src/models/prisma/prisma.module';
import { RequestsModule } from 'src/requests/requests.module';
import { AsyncModule } from 'src/async/async.module';

@Module({
  imports: [PrismaModule, RequestsModule, AsyncModule],
  controllers: [CloudsController],
  providers: [CloudsService],
})
export class CloudsModule {}
