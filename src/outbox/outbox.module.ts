import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OutboxQueueService } from './outbox-queue.service';

@Module({
  imports: [ConfigModule],
  providers: [OutboxQueueService],
  exports: [OutboxQueueService],
})
export class OutboxModule {}
