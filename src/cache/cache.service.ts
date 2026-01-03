import { Injectable } from '@nestjs/common';
import { BlobService } from '../blob/blob.service';

const OLD_INDICATOR_DAYS = 1;
const MAX_ITEMS_TO_REMOVE = 100;

@Injectable()
export class CacheService {
  constructor(private readonly blobService: BlobService) {}

  isItemOld(date: Date) {
    if (!date) {
      return false;
    }
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - OLD_INDICATOR_DAYS);
    return date < oneDayAgo;
  }

  async refresh() {
    const blobList = await this.blobService.list();
    if (!blobList?.length) {
      console.log('No blob items found');
      return;
    }
    console.log('Total blob items found:', blobList.length);
    const oldItems = blobList
      .filter(item => this.isItemOld(item.uploadedAt))
      .slice(0, MAX_ITEMS_TO_REMOVE);
    console.log('Old blob items found:', oldItems.length);
    let removedItems = 0;
    const deletePromises = oldItems.map(async item => {
      console.log(`Deleting old blob item: ${item.pathname} uploaded at ${item.uploadedAt}`);
      this.blobService.remove(item.pathname);
      removedItems++;
    });
    await Promise.all(deletePromises);
    console.log(`Total removed blob items: ${removedItems}`);
  }
}
