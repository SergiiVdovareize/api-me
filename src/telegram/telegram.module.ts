import { Module } from '@nestjs/common';
import { TelegramController } from './telegram.controller';
import { TelegramService } from './telegram.service';
import { TelegramProjectBoardService } from './services/telegram-project-board.service';
import { TranscriptionService } from './services/transcription.service';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [LlmModule],
  controllers: [TelegramController],
  providers: [
    TelegramService,
    TelegramProjectBoardService,
    TranscriptionService,
  ],
  exports: [TelegramService],
})
export class TelegramModule {}
