import { Injectable } from '@nestjs/common';
import { put, list, ListFoldedBlobResult } from '@vercel/blob';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello mr. Bob!';
  }

  async getRandomDate(): Promise<string> {
    const now = new Date();
    const beginningOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const dateFileName = `date-${beginningOfToday}`;
    const fileList: ListFoldedBlobResult = await list({ prefix: dateFileName });

    if (fileList?.blobs?.[0]?.url) {
      try {
        const data = await fetch(fileList?.blobs?.[0]?.url);
        const text = await data.text();
        return text;
      } catch (e) {
        console.error('Error fetching date blob:', e);
      }
    }

    const start = Date.UTC(2018, 7, 1);
    const end = Date.UTC(2022, 1, 22);
    const time = start + Math.floor(Math.random() * (end - start + 1));
    const d = new Date(time);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const date = `${yyyy}.${mm}.${dd}`;

    await put(dateFileName, date, {
      access: 'public',
      contentType: 'application/json',
    });

    return date;
  }
}
