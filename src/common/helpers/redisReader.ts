import { Redis } from '@upstash/redis';
import { env } from 'process';

const defaultTtl = 86400; // Default TTL of 1 day

const mainRedis = Redis.fromEnv();
const secondaryRedis = new Redis({
  url: env.UPSTASH_REDIS_2_REST_URL,
  token: env.UPSTASH_REDIS_2_REST_API_TOKEN,
});

export class RedisReader {
  get redis() {
    const currentDay = new Date().getDate();
    return currentDay % 2 == 0 ? mainRedis : secondaryRedis;
  }

  /**
   * Reads a value from Redis by key.
   * @param key The key to read.
   * @returns The value, or null if not found.
   */
  async read(key: string): Promise<any> {
    return await this.redis.get(key);
  }

  /**
   * Writes a value to Redis by key.
   * @param key The key to write.
   * @param value The value to write.
   * @returns The result of the set operation.
   */
  async write(key: string, value: any): Promise<any> {
    return await this.redis.set(key, value, { ex: defaultTtl });
  }

  /**
   * Deletes a value from Redis by key.
   * @param key The key to delete.
   * @returns The result of the delete operation.
   */
  async delete(key: string): Promise<any> {
    return await this.redis.del(key);
  }
}
