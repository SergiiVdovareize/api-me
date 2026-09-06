import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { SeriesTrackerModule } from '../src/series-tracker/series-tracker.module';
import { SeriesTrackerService } from '../src/series-tracker/series-tracker.service';

async function bootstrap() {
  const logger = new Logger('SeriesTrackerRunner');
  const startTime = Date.now();

  const args = process.argv.slice(2);
  let seriesId: string | undefined;
  let limit: number | undefined;
  let checkAll = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--id' && args[i + 1]) {
      seriesId = args[++i];
      checkAll = false;
    } else if (arg === '--limit' && args[i + 1]) {
      limit = parseInt(args[++i], 10);
      checkAll = false;
    } else if (arg === '--all') {
      checkAll = true;
    }
  }

  logger.log(
    `Starting standalone series release monitoring runner (mode: ${seriesId ? `single [${seriesId}]` : limit ? `limit [${limit}]` : 'all active series'})...`
  );

  const app = await NestFactory.createApplicationContext(SeriesTrackerModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const trackerService = app.get(SeriesTrackerService);
    const summary = await trackerService.checkSeriesReleases({
      seriesId,
      limit,
      checkAll,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.log(
      `Series check completed in ${elapsed}s. Checked: ${summary.checkedCount}, Notified: ${summary.notifiedCount}.`
    );

    await app.close();
    process.exit(0);
  } catch (error) {
    logger.error(`Execution failed: ${error.message}`, error.stack);
    await app.close();
    process.exit(1);
  }
}

bootstrap();
