import { Module } from '@nestjs/common';
import { AlphadateService } from './alphadate.service';
import { AlphadateController } from './alphadate.controller';
import { PrismaModule } from '../models/prisma/prisma.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [PrismaModule, EmailModule],
  controllers: [AlphadateController],
  providers: [AlphadateService],
  exports: [AlphadateService],
})
export class AlphadateModule {}
