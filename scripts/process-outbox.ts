import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { OutboxModule } from '../src/outbox/outbox.module';
import { OutboxQueueService } from '../src/outbox/outbox-queue.service';

async function bootstrap() {
  const logger = new Logger('OutboxQueueRunner');
  const startTime = Date.now();

  logger.log('Starting Telegram Outbox queue processing...');

  const app = await NestFactory.createApplicationContext(OutboxModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const outboxService = app.get(OutboxQueueService);
    const summary = await outboxService.processOutboxQueue();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.log(
      `Finished processing Telegram Outbox queue in ${elapsed}s: Total rows: ${summary.totalRows}, Processed: ${summary.processed}, Sent: ${summary.sent}, Errors: ${summary.errors}`
    );

    if (summary.errors > 0) {
      process.exitCode = 1;
    }
  } catch (error: any) {
    logger.error(`Failed to process Telegram Outbox queue: ${error.message}`, error.stack);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

bootstrap();
