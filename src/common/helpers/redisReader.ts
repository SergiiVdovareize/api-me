import { Redis } from '@upstash/redis';
import { env } from 'process';

// const mainRedis = Redis.fromEnv();
const secondaryRedis = new Redis({
  url: env.UPSTASH_REDIS_2_REST_URL,
  token: env.UPSTASH_REDIS_2_REST_API_TOKEN,
});

// const thirdRedis = new Redis({
//   url: env.UPSTASH_REDIS_3_REST_URL,
//   token: env.UPSTASH_REDIS_3_REST_API_TOKEN,
// });

// const redisMap = [
//   {
//     url: env.UPSTASH_REDIS_1_REST_URL,
//     token: env.UPSTASH_REDIS_1_REST_API_TOKEN,
//   },
//   {
//     url: env.UPSTASH_REDIS_2_REST_URL,
//     token: env.UPSTASH_REDIS_2_REST_API_TOKEN,
//   },
//   {
//     url: env.UPSTASH_REDIS_3_REST_URL,
//     token: env.UPSTASH_REDIS_3_REST_API_TOKEN,
//   },
// ];

const defaultTtl = 100800; // Default TTL of 28 hours
export class RedisReader {
  get redis() {
    // const dayNumber = Math.round((Date.now() - 1767229200000) / 100000 / 846);
    // const redisNumber = dayNumber % redisMap.length;

    // return isEven ? secondaryRedis : mainRedis;
    return secondaryRedis;
    // return redisMap[redisNumber];
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
