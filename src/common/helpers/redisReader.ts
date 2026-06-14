import * as Sentry from '@sentry/nestjs';
import { Redis } from '@upstash/redis';
import { env } from 'process';
import { Logger } from '@nestjs/common';

const defaultTtl = 100800; // Default TTL of 28 hours
const nudgeTtl = 43200; // 12 hours
const restUrlProp = 'UPSTASH_REDIS_REST_URL_';
const restTokenProp = 'UPSTASH_REDIS_REST_TOKEN_';
const redisPairs = Object.keys(env).filter(prop => prop.startsWith(restUrlProp));
const redisProfilesCount = redisPairs.length;
export class RedisReader {
  private readonly logger = new Logger(RedisReader.name);
  private cachedRedisNumber: number;

  get redis() {
    if (!this.cachedRedisNumber) {
      this.cachedRedisNumber = this.getRedisPairNumber();
      this.logger.log(`SET cachedRedisNumber: ${this.cachedRedisNumber}`);
    }
    return this.getRedisPair(redisPairs[this.cachedRedisNumber]);
  }

  getRedisPairNumber() {
    const dayNumber = Math.round((Date.now() - 1767229200000) / 100000 / 846);
    return dayNumber % redisProfilesCount;
  }

  getRedisPair(restUrl: string) {
    const suffixReg = new RegExp(`${restUrlProp}(.*)`);
    const pairSuffix = restUrl.match(suffixReg)[1];
    if (!pairSuffix) {
      return null;
    }

    return new Redis({
      url: env[`${restUrlProp}${pairSuffix}`],
      token: env[`${restTokenProp}${pairSuffix}`],
    });
  }

  /**
   * Reads a value from Redis by key.
   * @param key The key to read.
   * @returns The value, or null if not found.
   */
  async read(key: string): Promise<any> {
    try {
      return await this.redis.get(key);
    } catch (error) {
      Sentry.captureMessage(`couldn't read cache, key - ${key}, `, error);
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

  async nudgeAll(): Promise<any> {
    const key = 'daily-nudge-record';
    const value = Date.now();

    await Promise.all(
      redisPairs.map(async pairUrl => {
        const pairSuffix = pairUrl.match(/UPSTASH_REDIS_REST_URL_(.*)/)[1];
        // const redis = new Redis({
        //   url: env[`UPSTASH_REDIS_REST_URL_${pairSuffix}`],
        //   token: env[`UPSTASH_REDIS_REST_TOKEN_${pairSuffix}`],
        // });
        const redis = this.getRedisPair(pairUrl);
        try {
          await redis.set(key, value, { ex: nudgeTtl });
          this.logger.log(`successfully nudged UPSTASH_REDIS_REST_URL_${pairSuffix}`);
        } catch (error) {
          this.logger.error(`couldn't nudge UPSTASH_REDIS_REST_URL_${pairSuffix}`, error?.stack);
          Sentry.captureMessage(`couldn't nudge UPSTASH_REDIS_REST_URL_${pairSuffix}`, error);
        }
      })
    );
  }
}
