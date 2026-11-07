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

export interface VerifyAccessDto {
  key?: string;
  deviceId?: string;
  platform?: string;
}

export interface VerifyAccessResult {
  success: boolean;
  boundDeviceId: string;
  isNewBinding: boolean;
  platform: string;
}

export interface CatcastBindingRecord {
  boundDeviceId: string;
  platform: string;
  lastIp: string;
  activatedAt: string;
  lastUsedAt: string;
}

@Injectable()
export class CatcastService {
  private readonly logger = new Logger(CatcastService.name);
  private readonly inMemoryBindings = new Map<string, CatcastBindingRecord>();

  constructor(
    private readonly configService: ConfigService,
    private readonly redisReader: RedisReader
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
      return false;
    }
    return allowed.includes(key);
  }

  async verifyAccess(
    dto: VerifyAccessDto | undefined,
    clientIp: string
  ): Promise<VerifyAccessResult> {
    const key = dto?.key;
    if (!key || typeof key !== 'string' || key.trim() === '') {
      throw new BadRequestException({
        success: false,
        error: CATCAST_CONSTANTS.ERROR_CODES.KEY_REQUIRED,
        message: CATCAST_CONSTANTS.ERROR_MESSAGES.KEY_REQUIRED,
      });
    }

    const deviceId = dto?.deviceId;
    if (!deviceId || typeof deviceId !== 'string' || deviceId.trim() === '') {
      throw new BadRequestException({
        success: false,
        error: CATCAST_CONSTANTS.ERROR_CODES.DEVICE_ID_REQUIRED,
        message: CATCAST_CONSTANTS.ERROR_MESSAGES.DEVICE_ID_REQUIRED,
      });
    }

    const cleanKey = key.trim();
    const cleanDeviceId = deviceId.trim();
    const platform = (dto?.platform || 'web').trim();

    if (!this.isKeyValid(cleanKey)) {
      this.logger.warn(
        `Rejected invalid catcast access key attempt: "${cleanKey}" from device "${cleanDeviceId}" (IP: ${clientIp})`
      );
      throw new UnauthorizedException({
        success: false,
        error: CATCAST_CONSTANTS.ERROR_CODES.INVALID_KEY,
        message: CATCAST_CONSTANTS.ERROR_MESSAGES.INVALID_KEY,
      });
    }

    const normalizedIp = this.normalizeIp(clientIp);
    const existingRecord = await this.getBindingRecord(cleanKey);

    // First-time activation or unbound key (including seamless migration from legacy IP binding)
    if (!existingRecord || !existingRecord.boundDeviceId) {
      const now = new Date().toISOString();
      const newRecord: CatcastBindingRecord = {
        boundDeviceId: cleanDeviceId,
        platform,
        lastIp: normalizedIp,
        activatedAt: now,
        lastUsedAt: now,
      };

      await this.setBindingRecord(cleanKey, newRecord);
      this.logger.log(
        `Bound catcast key "${cleanKey.slice(0, 4)}***" to device "${cleanDeviceId}" (${platform})`
      );

      return {
        success: true,
        boundDeviceId: cleanDeviceId,
        isNewBinding: true,
        platform,
      };
    }

    // Check device binding
    if (existingRecord.boundDeviceId !== cleanDeviceId) {
      this.logger.warn(
        `Catcast key device mismatch for key "${cleanKey.slice(0, 4)}***": bound to "${existingRecord.boundDeviceId}", incoming: "${cleanDeviceId}"`
      );
      throw new ForbiddenException({
        success: false,
        error: CATCAST_CONSTANTS.ERROR_CODES.DEVICE_MISMATCH,
        message: CATCAST_CONSTANTS.ERROR_MESSAGES.DEVICE_MISMATCH,
      });
    }

    // Successful access from the same bound device - update metadata
    existingRecord.lastUsedAt = new Date().toISOString();
    existingRecord.lastIp = normalizedIp;
    if (dto?.platform && dto.platform.trim() !== existingRecord.platform) {
      existingRecord.platform = dto.platform.trim();
    }
    await this.setBindingRecord(cleanKey, existingRecord);

    return {
      success: true,
      boundDeviceId: existingRecord.boundDeviceId,
      isNewBinding: false,
      platform: existingRecord.platform,
    };
  }

  async resetBinding(key: string): Promise<boolean> {
    const cleanKey = key.trim();
    this.inMemoryBindings.delete(cleanKey);
    const deviceRedisKey = `${CATCAST_CONSTANTS.REDIS_KEY_PREFIX}${cleanKey}`;
    const legacyRedisKey = `${CATCAST_CONSTANTS.LEGACY_REDIS_KEY_PREFIX}${cleanKey}`;
    try {
      await Promise.all([
        this.redisReader.delete(deviceRedisKey),
        this.redisReader.delete(legacyRedisKey),
      ]);
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

  private async getBindingRecord(key: string): Promise<CatcastBindingRecord | null> {
    const deviceRedisKey = `${CATCAST_CONSTANTS.REDIS_KEY_PREFIX}${key}`;
    try {
      const cached = await this.redisReader.read(deviceRedisKey);
      if (cached) {
        if (typeof cached === 'object' && cached.boundDeviceId) {
          return cached as CatcastBindingRecord;
        }
        if (typeof cached === 'string') {
          try {
            const parsed = JSON.parse(cached);
            if (parsed && parsed.boundDeviceId) {
              return parsed as CatcastBindingRecord;
            }
          } catch {
            // ignore JSON parse error
          }
        }
      }
    } catch (err: any) {
      this.logger.warn(`Failed reading bound device from redis: ${err?.message}`);
    }

    const inMemory = this.inMemoryBindings.get(key);
    if (inMemory) return inMemory;

    // Check legacy Redis IP key for backward compatibility migration
    const legacyRedisKey = `${CATCAST_CONSTANTS.LEGACY_REDIS_KEY_PREFIX}${key}`;
    try {
      const legacyCached = await this.redisReader.read(legacyRedisKey);
      if (typeof legacyCached === 'string' && legacyCached.length > 0) {
        return {
          boundDeviceId: '',
          platform: 'web',
          lastIp: legacyCached,
          activatedAt: new Date().toISOString(),
          lastUsedAt: new Date().toISOString(),
        };
      }
    } catch {
      // ignore legacy read error
    }

    return null;
  }

  private async setBindingRecord(key: string, record: CatcastBindingRecord): Promise<void> {
    this.inMemoryBindings.set(key, record);
    const deviceRedisKey = `${CATCAST_CONSTANTS.REDIS_KEY_PREFIX}${key}`;
    const legacyRedisKey = `${CATCAST_CONSTANTS.LEGACY_REDIS_KEY_PREFIX}${key}`;
    try {
      await this.redisReader.write(deviceRedisKey, record, CATCAST_CONSTANTS.DEFAULT_TTL);
      // Clean up legacy IP key if present
      await this.redisReader.delete(legacyRedisKey);
    } catch (err: any) {
      this.logger.warn(`Failed writing bound device to redis: ${err?.message}`);
    }
  }
}
