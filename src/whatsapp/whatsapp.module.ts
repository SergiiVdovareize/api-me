import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LlmModule } from '../llm/llm.module';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappService } from './whatsapp.service';
import { TranscriptionService } from './services/transcription.service';
import { WhatsappProjectBoardService } from './services/whatsapp-project-board.service';

@Module({
  imports: [ConfigModule, LlmModule],
  controllers: [WhatsappController],
  providers: [WhatsappService, TranscriptionService, WhatsappProjectBoardService],
  exports: [WhatsappService, WhatsappProjectBoardService],
})
export class WhatsappModule {}
