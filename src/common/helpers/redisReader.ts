import { Redis } from '@upstash/redis';
import { env } from 'process';

const redisProfilesCount = Object.keys(env).filter(prop =>
  prop.startsWith('UPSTASH_REDIS_REST_URL')
).length;

const defaultTtl = 100800; // Default TTL of 28 hours
export class RedisReader {
  private async withRetry<T>(fn: () => Promise<T>, retries = 3, initialDelay = 100): Promise<T> {
    for (let i = 0; ; i++) {
      try {
        return await fn();
      } catch (err: any) {
        const code = err?.code;
        const msg = String(err?.message || err);
        const transient = ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN'].includes(code) || /fetch failed/i.test(msg);
        if (!transient || i >= retries) {
          throw err;
        }
        const delay = initialDelay * Math.pow(2, i);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  get redis() {
    if (redisProfilesCount === 0) {
      throw new Error('No UPSTASH_REDIS_REST_URL_* environment variables found');
    }

    const dayNumber = Math.round((Date.now() - 1767229200000) / 100000 / 846);
    const redisNumber = (dayNumber % redisProfilesCount) + 1;

    const url = env[`UPSTASH_REDIS_REST_URL_${redisNumber}`];
    const token = env[`UPSTASH_REDIS_REST_TOKEN_${redisNumber}`];

    if (!url || !token) {
      throw new Error(`Missing Upstash credentials for redis profile ${redisNumber}`);
    }

    return new Redis({ url, token });
  }

  /**
   * Reads a value from Redis by key with retry for transient errors.
   * @param key The key to read.
   * @returns The value, or null if not found.
   */
  async read(key: string): Promise<any> {
    console.log('key', key)
    return await this.withRetry(() => this.redis.get(key));
  }

  /**
   * Writes a value to Redis by key with retry for transient errors.
   * @param key The key to write.
   * @param value The value to write.
   * @returns The result of the set operation.
   */
  async write(key: string, value: any): Promise<any> {
    return await this.withRetry(() => this.redis.set(key, value, { ex: defaultTtl }));
  }

  /**
   * Deletes a value from Redis by key with retry for transient errors.
   * @param key The key to delete.
   * @returns The result of the delete operation.
   */
  async delete(key: string): Promise<any> {
    return await this.withRetry(() => this.redis.del(key));
  }
}
