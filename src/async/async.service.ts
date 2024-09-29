import { Injectable } from '@nestjs/common';
import { put, del, list, ListFoldedBlobResult } from '@vercel/blob';
import { uid } from 'uid';

const SYNC_TIMEOUT = 1000;

@Injectable()
export class AsyncService {
  async prepareResult(execute: Function) {
    console.log('async service calls')
    const result: { type: 'sync' | 'async'; data: string | object } = {
      type: null,
      data: null,
    };
    return new Promise((resolve: Function) => {
      const fileName = this.generateFilename();

      const resolveTimeoutId = setTimeout(() => {
        if (result.type == 'sync') {
          return;
        }

        result.type = 'async';
        result.data = fileName;
        resolve(result);
      }, SYNC_TIMEOUT);

      execute().then((data: JSON) => {
        if (result.type == 'async') {
          this.createResultFile(fileName, data);
        } else {
          clearTimeout(resolveTimeoutId);
          result.type = 'sync';
          result.data = data;
          resolve(result);
        }
      });
    });
  }

  generateFilename() {
    const base = Date.now()
      .toString()
      .match(/.{1,3}/g)
      .reverse();
    const fileName = `${uid(2)}${base[0]}${uid(2)}${base[1]}${uid(2)}${base[4]}${uid(2)}${base[3]}${uid(2)}${base[2]}${uid(2)}`;
    return fileName;
  }

  removeResultFile(url: string): void {
    del(url);
  }

  async createResultFile(filename: string, data: JSON): Promise<string> {
    const blob = await put(filename, JSON.stringify(data), {
      access: 'public',
      contentType: 'application/json',
    });

    return blob.url;
  }

  async findResultFileUrl(id: string): Promise<string | null> {
    const fileList: ListFoldedBlobResult = await list({ prefix: id });
    return fileList.blobs.length === 1 ? fileList.blobs[0].url : null;
  }

  async findResultFileUrlWithRetry(
    id: string,
    attempt: number = 0,
  ): Promise<string | null> {
    const maxTries = 7;
    const retryDelay = 500;
    return new Promise(async (resolve) => {
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
      this.removeResultFile(url);
      return json;
    } catch (error) {
      return null;
    }
  }
}
