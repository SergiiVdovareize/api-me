import { Injectable, Logger } from '@nestjs/common';
import { BlobService } from '../blob/blob.service';
import { DATE_CONSTANTS } from './date.constants';

@Injectable()
export class DateService {
  private readonly logger = new Logger(DateService.name);

  constructor(private readonly blobService: BlobService) {}

  async getRandomDate(): Promise<string> {
    const now = new Date();
    const beginningOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const dateFileName = `date-${beginningOfToday}`;

    const content = await this.blobService.read(dateFileName);
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
    } catch (error) {
      // Log error but do not fail the request
      this.logger.error('Error caching date blob:', error?.stack);
      return null;
    }

    return date;
  }
}
