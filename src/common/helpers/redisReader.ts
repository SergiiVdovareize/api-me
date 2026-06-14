import * as Sentry from '@sentry/nestjs';
import { Redis } from '@upstash/redis';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { REDIS_CONSTANTS } from './redis.constants';

@Injectable()
export class RedisReader {
  private readonly logger = new Logger(RedisReader.name);
  private cachedRedisNumber: number | undefined;
  private redisPairs: string[] = [];

  constructor(private readonly configService: ConfigService) {
    this.redisPairs = Object.keys(process.env).filter(prop =>
      prop.startsWith(REDIS_CONSTANTS.REST_URL_PROP)
    );
  }

  get redis() {
    if (this.cachedRedisNumber === undefined) {
      this.cachedRedisNumber = this.getRedisPairNumber();
      this.logger.log(`SET cachedRedisNumber: ${this.cachedRedisNumber}`);
    }
    return this.getRedisPair(this.redisPairs[this.cachedRedisNumber]);
  }

  getRedisPairNumber() {
    const dayNumber = Math.round((Date.now() - REDIS_CONSTANTS.BASE_TIMESTAMP) / 100000 / 846);
    const redisProfilesCount = this.redisPairs.length;
    return redisProfilesCount > 0 ? dayNumber % redisProfilesCount : 0;
  }

  getRedisPair(restUrl: string) {
    if (!restUrl) {
      return null;
    }
    const suffixReg = new RegExp(`${REDIS_CONSTANTS.REST_URL_PROP}(.*)`);
    const match = restUrl.match(suffixReg);
    const pairSuffix = match ? match[1] : null;
    if (!pairSuffix) {
      return null;
    }

    const url = this.configService.get<string>(`${REDIS_CONSTANTS.REST_URL_PROP}${pairSuffix}`);
    const token = this.configService.get<string>(`${REDIS_CONSTANTS.REST_TOKEN_PROP}${pairSuffix}`);

    return new Redis({
      url,
      token,
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
    return await this.redis.set(key, value, { ex: REDIS_CONSTANTS.DEFAULT_TTL });
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
      this.redisPairs.map(async pairUrl => {
        const match = pairUrl.match(/UPSTASH_REDIS_REST_URL_(.*)/);
        const pairSuffix = match ? match[1] : null;
        if (!pairSuffix) return;

        const redis = this.getRedisPair(pairUrl);
        if (!redis) return;

        try {
          await redis.set(key, value, { ex: REDIS_CONSTANTS.NUDGE_TTL });
          this.logger.log(`successfully nudged UPSTASH_REDIS_REST_URL_${pairSuffix}`);
        } catch (error) {
          this.logger.error(`couldn't nudge UPSTASH_REDIS_REST_URL_${pairSuffix}`, error?.stack);
          Sentry.captureMessage(`couldn't nudge UPSTASH_REDIS_REST_URL_${pairSuffix}`, error);
        }
      })
    );
  }
}
