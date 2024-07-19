import { Module } from '@nestjs/common';
import { CloudsController } from './clouds.controller';
import { CloudsService } from './clouds.service';
import { RequestsService } from 'src/requests/requests.service';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CloudsController],
  providers: [CloudsService, RequestsService],
})
export class CloudsModule {}
