import { Injectable } from '@nestjs/common';
import { del, list } from '@vercel/blob';

const OLD_INDICATOR_DAYS = 1;
const MAX_BLOBS_TO_REMOVE = 100;

@Injectable()
export class BlobService {
  isBlobOld(date: Date) {
    if (!date) {
      return false;
    }

    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - OLD_INDICATOR_DAYS);
    return date < oneDayAgo;
  }

  async refresh() {
    const blobList = await list();
    if (!blobList || !blobList.blobs || blobList.blobs.length === 0) {
      console.log('No blobs found');
      return;
    }

    console.log('Total blobs found:', blobList.blobs.length);

    const oldBlobs = blobList.blobs
      .filter(blob => this.isBlobOld(blob.uploadedAt))
      .slice(0, MAX_BLOBS_TO_REMOVE);

    console.log('Old blobs found:', oldBlobs.length);

    let removedBlobs = 0;

    const deletePromises = oldBlobs.map(async blob => {
      console.log(`Deleting old blob: ${blob.pathname} uploaded at ${blob.uploadedAt}`);
      del(blob.pathname);
      removedBlobs++;
    });

    await Promise.all(deletePromises);
    console.log(`Total removed blobs: ${removedBlobs}`);
  }
}
