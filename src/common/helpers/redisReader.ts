import { Redis } from '@upstash/redis';
import { env } from 'process';

const mainRedis = Redis.fromEnv();
const secondaryRedis = new Redis({
  url: env.UPSTASH_REDIS_2_REST_URL,
  token: env.UPSTASH_REDIS_2_REST_API_TOKEN,
});

const defaultTtl = 72000; // Default TTL of 20 hours
export class RedisReader {
  get redis() {
    const date = new Date();
    const currentDay = date.getDate();

    let isEven: boolean;
    if (currentDay === 31) {
      const currentMonth = date.getMonth();
      isEven = currentMonth % 2 === 0;
    } else {
      isEven = currentDay % 2 === 0;
    }

    return isEven ? mainRedis : secondaryRedis;
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
