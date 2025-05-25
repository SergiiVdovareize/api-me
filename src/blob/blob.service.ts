import { Injectable } from '@nestjs/common';
import { del, list } from '@vercel/blob';
import { BlobReader } from 'src/common/helpers/blobReader';

const OLD_INDICATOR_DAYS = 1;

@Injectable()
export class BlobService {
  constructor(private readonly blobReader: BlobReader) {}

  isBlobOld(date: Date) {
    if (!date) {
      return false;
    }

    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - OLD_INDICATOR_DAYS);
    return date < oneDayAgo;
  }

  async refresh() {
    const maxBlobsToRemoved = 20;
    const blobList = await list();
    if (!blobList || !blobList.blobs || blobList.blobs.length === 0) {
      console.log('No blobs found');
      return;
    }

    console.log('Total blobs found:', blobList.blobs.length);

    const oldBlobs = blobList.blobs
      .filter(blob => this.isBlobOld(blob.uploadedAt))
      .slice(0, maxBlobsToRemoved);

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
