import { Module } from '@nestjs/common';
import { GameResultsService } from './game-results.service';
import { GameResultsController } from './game-results.controller';
import { PrismaModule } from '../models/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [GameResultsController],
  providers: [GameResultsService],
})
export class GameResultsModule {}
