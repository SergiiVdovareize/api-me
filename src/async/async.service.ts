import { Injectable, Optional } from '@nestjs/common';
import { put, del, list, ListFoldedBlobResult } from '@vercel/blob';
import { uid } from 'uid';
import { ASYNC_CONSTANTS } from './async.constants';
import { BlobService } from '../blob/blob.service';

@Injectable()
export class AsyncService {
  constructor(@Optional() private readonly blobService?: BlobService) {}

  async prepareResult(execute: () => Promise<JSON>, track?: () => void) {
    const result: { type: 'sync' | 'async'; data: string | object } = {
      type: null,
      data: null,
    };
    return new Promise(resolve => {
      const fileName = this.generateFilename();

      const resolveTimeoutId = setTimeout(() => {
        if (result.type == 'sync') {
          return;
        }

        result.type = 'async';
        result.data = fileName;
        resolve(result);
      }, ASYNC_CONSTANTS.SYNC_TIMEOUT);

      execute().then((data: JSON) => {
        if (result.type == 'async') {
          this.createResultFile(fileName, data);
        } else {
          clearTimeout(resolveTimeoutId);
          result.type = 'sync';
          result.data = data;
          resolve(result);
        }

        track?.();
      });
    });
  }

  generateFilename() {
    const base = Date.now()
      .toString()
      .match(/.{1,3}/g)
      .reverse();
    const fileName = `cache-${uid(2)}${base[0]}${uid(2)}${base[1]}${uid(2)}${base[4]}${uid(2)}${base[3]}${uid(2)}${base[2]}${uid(2)}`;
    return fileName;
  }

  removeResultFile(url: string): void {
    if (this.blobService) {
      this.blobService.remove(url).catch(() => {});
      return;
    }
    del(url);
  }

  async createResultFile(filename: string, data: JSON): Promise<string> {
    const clean = filename.replace(/^cache\//, '');
    const targetFilename = clean.startsWith('cache-') ? `cache/${clean}` : `cache/cache-${clean}`;
    if (this.blobService) {
      const blob = await this.blobService.create(targetFilename, data);
      return blob.url;
    }
    const blob = await put(targetFilename, JSON.stringify(data), {
      access: 'public',
      contentType: 'application/json',
    });

    return blob.url;
  }

  async findResultFileUrl(id: string): Promise<string | null> {
    const clean = id.replace(/^cache\//, '');
    const prefixInFolder = clean.startsWith('cache-') ? `cache/${clean}` : `cache/cache-${clean}`;
    if (this.blobService) {
      let blobs = await this.blobService.list(prefixInFolder);
      if (blobs.length !== 1) {
        blobs = await this.blobService.list(`cache/${clean}`);
      }
      if (blobs.length !== 1) {
        const legacyPrefix = clean.startsWith('cache-') ? clean : `cache-${clean}`;
        blobs = await this.blobService.list(legacyPrefix);
      }
      return blobs.length === 1 ? blobs[0].url : null;
    }
    let fileList: ListFoldedBlobResult = await list({ prefix: prefixInFolder });
    if (fileList.blobs.length !== 1) {
      fileList = await list({ prefix: `cache/${clean}` });
    }
    if (fileList.blobs.length !== 1) {
      const legacyPrefix = clean.startsWith('cache-') ? clean : `cache-${clean}`;
      fileList = await list({ prefix: legacyPrefix });
    }
    return fileList.blobs.length === 1 ? fileList.blobs[0].url : null;
  }

  async findResultFileUrlWithRetry(id: string, attempt: number = 0): Promise<string | null> {
    const maxTries = ASYNC_CONSTANTS.MAX_TRIES;
    const retryDelay = ASYNC_CONSTANTS.RETRY_DELAY;
    return new Promise(async resolve => {
      const url = await this.findResultFileUrl(id);
      // console.log('attempt - ', attempt, id, url)
      if (url) {
        resolve(url);
        return;
      }
      if (!url && attempt < maxTries) {
        setTimeout(async () => {
          resolve(await this.findResultFileUrlWithRetry(id, attempt + 1));
        }, retryDelay);
      } else {
        resolve(null);
      }
    });
  }

  async readResult(url: string): Promise<JSON> {
    try {
      const data = await fetch(url);
      const json = await data.json();
      // this.removeResultFile(url);
      return json;
    } catch (error) {
      console.error('Error reading result file:', error);
      return null;
    }
  }
}
