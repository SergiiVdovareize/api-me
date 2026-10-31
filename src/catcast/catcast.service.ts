import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisReader } from '../common/helpers/redisReader';
import { CATCAST_CONSTANTS } from './catcast.constants';

export interface VerifyAccessResult {
  success: boolean;
  boundIp: string;
  isNewBinding: boolean;
}

@Injectable()
export class CatcastService {
  private readonly logger = new Logger(CatcastService.name);
  private readonly inMemoryBindings = new Map<string, { boundIp: string; boundAt: number }>();

  constructor(
    private readonly configService: ConfigService,
    private readonly redisReader: RedisReader,
  ) {}

  getAllowedKeys(): string[] {
    const rawKeys = this.configService.get<string>(CATCAST_CONSTANTS.CONFIG_KEYS.ACCESS_KEYS) || '';
    return rawKeys
      .split(',')
      .map(k => k.trim())
      .filter(k => k.length > 0);
  }

  isKeyValid(key: string): boolean {
    const allowed = this.getAllowedKeys();
    if (allowed.length === 0) {
      // If no keys configured in env, allow keys matching format or fallback
      return false;
    }
    return allowed.includes(key);
  }

  async verifyAccess(key: string | undefined, clientIp: string): Promise<VerifyAccessResult> {
    if (!key || typeof key !== 'string' || key.trim() === '') {
      throw new BadRequestException(CATCAST_CONSTANTS.ERROR_MESSAGES.KEY_REQUIRED);
    }

    const cleanKey = key.trim();
    if (!this.isKeyValid(cleanKey)) {
      this.logger.warn(`Rejected invalid catcast access key attempt: "${cleanKey}" from IP: ${clientIp}`);
      throw new UnauthorizedException(CATCAST_CONSTANTS.ERROR_MESSAGES.INVALID_KEY);
    }

    const normalizedIp = this.normalizeIp(clientIp);
    const existingBoundIp = await this.getBoundIp(cleanKey);

    if (!existingBoundIp) {
      // First time this key is used: bind to client's IP
      await this.setBoundIp(cleanKey, normalizedIp);
      this.logger.log(`Bound catcast key "${cleanKey.slice(0, 4)}***" to IP: ${normalizedIp}`);
      return {
        success: true,
        boundIp: normalizedIp,
        isNewBinding: true,
      };
    }

    if (existingBoundIp !== normalizedIp) {
      this.logger.warn(
        `Catcast key IP mismatch for key "${cleanKey.slice(0, 4)}***": bound to ${existingBoundIp}, incoming: ${normalizedIp}`
      );
      throw new ForbiddenException(CATCAST_CONSTANTS.ERROR_MESSAGES.IP_MISMATCH);
    }

    return {
      success: true,
      boundIp: normalizedIp,
      isNewBinding: false,
    };
  }

  async resetBinding(key: string): Promise<boolean> {
    const cleanKey = key.trim();
    this.inMemoryBindings.delete(cleanKey);
    const redisKey = `${CATCAST_CONSTANTS.REDIS_KEY_PREFIX}${cleanKey}`;
    try {
      await this.redisReader.delete(redisKey);
      return true;
    } catch {
      return false;
    }
  }

  private normalizeIp(ip: string): string {
    if (!ip) return '127.0.0.1';
    let clean = ip.trim();
    if (clean.includes(',')) {
      clean = clean.split(',')[0].trim();
    }
    // Convert IPv6 localhost to IPv4
    if (clean === '::1' || clean === '::ffff:127.0.0.1') {
      return '127.0.0.1';
    }
    if (clean.startsWith('::ffff:')) {
      return clean.slice(7);
    }
    return clean;
  }

  private async getBoundIp(key: string): Promise<string | null> {
    const redisKey = `${CATCAST_CONSTANTS.REDIS_KEY_PREFIX}${key}`;
    try {
      const cached = await this.redisReader.read(redisKey);
      if (typeof cached === 'string' && cached.length > 0) {
        return cached;
      }
    } catch (err: any) {
      this.logger.warn(`Failed reading bound IP from redis: ${err?.message}`);
    }

    const inMemory = this.inMemoryBindings.get(key);
    return inMemory ? inMemory.boundIp : null;
  }

  private async setBoundIp(key: string, ip: string): Promise<void> {
    this.inMemoryBindings.set(key, { boundIp: ip, boundAt: Date.now() });
    const redisKey = `${CATCAST_CONSTANTS.REDIS_KEY_PREFIX}${key}`;
    try {
      await this.redisReader.write(redisKey, ip, CATCAST_CONSTANTS.DEFAULT_TTL);
    } catch (err: any) {
      this.logger.warn(`Failed writing bound IP to redis: ${err?.message}`);
    }
  }
}
