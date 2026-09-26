import { Module } from '@nestjs/common';
import { AlphadateService } from './alphadate.service';
import { AlphadateController } from './alphadate.controller';
import { PrismaModule } from '../models/prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { GenderizeService } from './genderize.service';
import { LlmModule } from '../llm/llm.module';
import { RedisReader } from '../common/helpers/redisReader';

@Module({
  imports: [PrismaModule, EmailModule, LlmModule],
  controllers: [AlphadateController],
  providers: [AlphadateService, GenderizeService, RedisReader],
  exports: [AlphadateService, GenderizeService],
})
export class AlphadateModule {}
