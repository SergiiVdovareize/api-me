import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OutboxQueueService } from './outbox-queue.service';
import { TelegramService } from './telegram.service';
import { OutboxController } from './outbox.controller';

@Module({
  imports: [ConfigModule],
  controllers: [OutboxController],
  providers: [OutboxQueueService, TelegramService],
  exports: [OutboxQueueService, TelegramService],
})
export class OutboxModule {}
