import { list, del, put } from '@vercel/blob';

/**
 * Helper class for reading blob files by exact name using @vercel/blob and fetch.
 */
export class BlobReader {
  /**
   * Reads the contents of a blob file by its exact name.
   * @param fileName The exact blob file name to read.
   * @returns The file contents as a parsed JSON object.
   */
  async read(fileName: string): Promise<any> {
    const blobs = await list({ prefix: fileName });
    const blob = blobs.blobs.find(b => b.pathname === fileName);
    if (!blob) {
      return null;
    }

    const response = await fetch(blob.url);
    if (!response.ok) {
      return null;
    }

    return await response.json();
  }

  /**
   * Deletes a blob file by its exact name.
   * @param fileName The exact blob file name to delete.
   * @returns True if the file was deleted, false if the file was not found.
   */
  async delete(fileName: string): Promise<boolean> {
    await del(fileName);
    return true;
  }

  async create(fileName: string, data: any) {
    return await put(fileName, JSON.stringify(data), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: false,
    });
  }
}
