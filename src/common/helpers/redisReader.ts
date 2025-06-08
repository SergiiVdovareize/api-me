import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

const defaultTtl = 86400; // Default TTL of 1 day

export class RedisReader {
  /**
   * Reads a value from Redis by key.
   * @param key The key to read.
   * @returns The value, or null if not found.
   */
  async read(key: string): Promise<any> {
    return await redis.get(key);
  }

  /**
   * Writes a value to Redis by key.
   * @param key The key to write.
   * @param value The value to write.
   * @returns The result of the set operation.
   */
  async write(key: string, value: any): Promise<any> {
    return await redis.set(key, value, { ex: defaultTtl });
  }

  /**
   * Deletes a value from Redis by key.
   * @param key The key to delete.
   * @returns The result of the delete operation.
   */
  async delete(key: string): Promise<any> {
    return await redis.del(key);
  }
}
