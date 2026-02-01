import { Redis } from '@upstash/redis';
import { env } from 'process';

const redisProfilesCount = Object.keys(env).filter(prop =>
  prop.startsWith('UPSTASH_REDIS_REST_URL')
).length;

const defaultTtl = 100800; // Default TTL of 28 hours
export class RedisReader {
  get redis() {
    const dayNumber = Math.round((Date.now() - 1767229200000) / 100000 / 846);
    const redisNumber = (dayNumber % redisProfilesCount) + 1;

    console.log('URL', redisNumber, env[`UPSTASH_REDIS_REST_URL_${redisNumber}`])
    return new Redis({
      url: env[`UPSTASH_REDIS_REST_URL_${redisNumber}`],
      token: env[`UPSTASH_REDIS_REST_TOKEN_${redisNumber}`],
    });
  }

  /**
   * Reads a value from Redis by key.
   * @param key The key to read.
   * @returns The value, or null if not found.
   */
  async read(key: string): Promise<any> {
    console.log('key', key)
    try {
      return await this.redis.get(key);
    } catch(error) {
      console.log('error', error)
      return null;
    }
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
