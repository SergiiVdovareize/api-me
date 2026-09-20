import { Module } from '@nestjs/common';
import { AlphadateService } from './alphadate.service';
import { AlphadateController } from './alphadate.controller';
import { PrismaModule } from '../models/prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { GenderizeService } from './genderize.service';

@Module({
  imports: [PrismaModule, EmailModule],
  controllers: [AlphadateController],
  providers: [AlphadateService, GenderizeService],
  exports: [AlphadateService, GenderizeService],
})
export class AlphadateModule {}
