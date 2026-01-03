import { Injectable } from '@nestjs/common';
import { BlobService } from '../blob/blob.service';

@Injectable()
export class DateService {
  constructor(private readonly blobService: BlobService) {}

  async getRandomDate(): Promise<string> {
    const now = new Date();
    const beginningOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const dateFileName = `date-${beginningOfToday}`;

    const content = await this.blobService.read(dateFileName);
    if (content) {
      return content?.date;
    }

    const start = Date.UTC(2018, 7, 1);
    const end = Date.UTC(2022, 1, 22);
    const time = start + Math.floor(Math.random() * (end - start + 1));
    const d = new Date(time);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const date = `${yyyy}.${mm}.${dd}`;

    try {
      await this.blobService.create(dateFileName, { date });
    } catch (error) {
      // Log error but do not fail the request
      console.error('Error caching date blob:', error);
      return null;
    }

    return date;
  }
}
