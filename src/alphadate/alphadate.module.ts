import { Module } from '@nestjs/common';
import { AlphadateService } from './alphadate.service';
import { AlphadateController } from './alphadate.controller';
import { PrismaModule } from '../models/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AlphadateController],
  providers: [AlphadateService],
  exports: [AlphadateService],
})
export class AlphadateModule {}
