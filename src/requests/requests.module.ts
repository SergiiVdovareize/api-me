import { Module } from '@nestjs/common';
import { RequestsService } from './requests.service';
import { RequestsController } from './requests.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PosthogService } from 'src/posthog/posthog.service';

@Module({
  controllers: [RequestsController],
  providers: [RequestsService, PosthogService],
  imports: [PrismaModule],
})
export class RequestsModule {}
