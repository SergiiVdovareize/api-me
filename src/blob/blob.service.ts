import { Injectable, Logger } from '@nestjs/common';
import { put, del, list, ListFoldedBlobResult } from '@vercel/blob';

@Injectable()
export class BlobService {
  private readonly logger = new Logger(BlobService.name);

  /**
   * Find blob files by optional prefix filter.
   * @param prefix Optional prefix to filter blobs.
   * @returns List of blob objects matching the prefix.
   */
  async list(prefix?: string): Promise<any[]> {
    try {
      const fileList: ListFoldedBlobResult = await list({ prefix });
      this.logger.log(
        `Found ${fileList?.blobs?.length || 0} blobs with prefix: ${prefix || 'none'}`
      );
      return fileList?.blobs || [];
    } catch (error) {
      this.logger.error(`Error finding blobs with prefix ${prefix}:`, error);
      throw error;
    }
  }

  /**
   * Find a blob file by exact name match.
   * @param name The exact blob file name/key to find.
   * @returns The blob object if found, null otherwise.
   */
  async find(name: string): Promise<any | null> {
    try {
      const blobs = await this.list(name);
      const blob = blobs.find(b => b.pathname === name);
      if (blob) {
        this.logger.log(`Found blob by name: ${name}`);
      } else {
        this.logger.log(`Blob not found by name: ${name}`);
      }
      return blob || null;
    } catch (error) {
      this.logger.error(`Error finding blob by name ${name}:`, error);
      throw error;
    }
  }

  /**
   * Read and return the content of a blob file.
   * @param name The blob file name/key to read.
   * @returns The blob file content as string or parsed JSON.
   */
  async read(name: string): Promise<any> {
    try {
      const blob = await this.find(name);
      if (!blob || !blob.url) {
        this.logger.warn(`Cannot read blob ${name}: blob not found or no URL`);
        return null;
      }

      const response = await fetch(blob.url);
      if (!response.ok) {
        throw new Error(`Failed to fetch blob: ${response.statusText}`);
      }

      const content = await response.json();
      this.logger.log(`Blob content read successfully: ${name}`);
      return content;
    } catch (error) {
      this.logger.error(`Error reading blob ${name}:`, error);
      throw error;
    }
  }

  /**
   * Add/upload a blob file.
   * @param key The blob file name/key.
   * @param data The data to store (string, JSON, etc).
   * @returns The result from Vercel Blob put operation.
   */
  async create(key: string, data: any): Promise<any> {
    try {
      const result = await put(key, JSON.stringify(data), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: false,
      });
      this.logger.log(`Blob added: ${key}`);
      return result;
    } catch (error) {
      this.logger.error(`Error adding blob ${key}:`, error);
      throw error;
    }
  }

  /**
   * Remove a blob file.
   * @param key The blob file name/key to delete.
   * @returns The result from Vercel Blob del operation.
   */
  async remove(key: string): Promise<any> {
    try {
      const result = await del(key);
      this.logger.log(`Blob removed: ${key}`);
      return result;
    } catch (error) {
      this.logger.error(`Error removing blob ${key}:`, error);
      throw error;
    }
  }
}
