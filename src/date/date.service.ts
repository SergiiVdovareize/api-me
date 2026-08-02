import { Injectable, Logger } from '@nestjs/common';
import { BlobService } from '../blob/blob.service';
import { RedisReader } from '../common/helpers/redisReader';
import { DATE_CONSTANTS } from './date.constants';

@Injectable()
export class DateService {
  private readonly logger = new Logger(DateService.name);

  constructor(
    private readonly blobService: BlobService,
    private readonly redisReader: RedisReader
  ) {}

  async getRandomDate(): Promise<string> {
    const now = new Date();
    const beginningOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const dateFileName = `date-${beginningOfToday}`;

    let content: any = null;
    try {
      content = await this.blobService.read(dateFileName);
    } catch (error) {
      this.logger.warn(`Failed to read from Blob: ${error.message}. Trying Redis fallback...`);
      try {
        content = await this.redisReader.read(dateFileName);
      } catch (redisError) {
        this.logger.error(`Failed to read from Redis fallback: ${redisError.message}`);
      }
    }

    if (content) {
      return content?.date;
    }

    const start = DATE_CONSTANTS.START_DATE;
    const end = DATE_CONSTANTS.END_DATE;
    const time = start + Math.floor(Math.random() * (end - start + 1));
    const d = new Date(time);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const date = `${dd}.${mm}.${yyyy}`;

    try {
      await this.blobService.create(dateFileName, { date });
      try {
        await this.redisReader.write(dateFileName, { date });
      } catch (redisError) {
        this.logger.error(`Failed to write to Redis fallback cache: ${redisError.message}`);
      }
    } catch (error) {
      this.logger.error('Error caching date blob, falling back to Redis:', error?.stack);
      try {
        await this.redisReader.write(dateFileName, { date });
      } catch (redisError) {
        this.logger.error(`Error caching date in Redis fallback: ${redisError.message}`);
        return null;
      }
    }

    return date;
  }
}
