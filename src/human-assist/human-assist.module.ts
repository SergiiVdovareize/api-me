import { Module } from '@nestjs/common';
import { HumanAssistController } from './human-assist.controller';
import { HumanAssistService } from './human-assist.service';
import { HumanAssistGuard } from './human-assist.guard';
import { PrismaModule } from '../models/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [HumanAssistController],
  providers: [HumanAssistService, HumanAssistGuard],
  exports: [HumanAssistService],
})
export class HumanAssistModule {}
