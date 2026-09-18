import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { CnapModule } from '../src/cnap/cnap.module';
import { CnapService } from '../src/cnap/cnap.service';

async function bootstrap() {
  const logger = new Logger('CnapRunner');
  const startTime = Date.now();

  const args = process.argv.slice(2);
  let category = 'Паспортні послуги';
  let service: string | undefined;
  let location = 'Хвильового';
  let notify = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--category' && args[i + 1]) {
      category = args[++i];
    } else if (arg === '--service' && args[i + 1]) {
      service = args[++i];
    } else if (arg === '--location' && args[i + 1]) {
      location = args[++i];
    } else if (arg === '--no-notify') {
      notify = false;
    } else if (arg === '--on-slots-only') {
      notify = false; // will be passed as 'on-slots'
    }
  }

  logger.log(
    `Starting CNAP check runner (category: "${category}", location: "${location}", notify Telegram Outbox: ${notify})...`
  );

  const app = await NestFactory.createApplicationContext(CnapModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const cnapService = app.get(CnapService);
    const response = await cnapService.checkAndNotify({
      category,
      service,
      location,
      notify: args.includes('--on-slots-only') ? 'on-slots' : notify,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.log(
      `Check completed in ${elapsed}s. Has slots: ${response.hasSlots}. Telegram queued: ${response.telegramQueued}.`
    );
    console.log('\n--- Telegram Report Message ---');
    console.log(response.report);
    console.log('-------------------------------\n');

    await app.close();
    process.exit(response.hasSlots ? 0 : 2);
  } catch (error: any) {
    logger.error(`Execution failed: ${error.message}`, error.stack);
    await app.close();
    process.exit(1);
  }
}

bootstrap();
