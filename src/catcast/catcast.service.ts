import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CATCAST_CONSTANTS } from './catcast.constants';
import { RedisReader } from '../common/helpers/redisReader';
import { PrismaService } from '../models/prisma/prisma.service';

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
    private readonly redisReader: RedisReader,
    @Optional() private readonly prisma?: PrismaService
  ) {}

  /**
   * Generates a completely random, lowercase alphanumeric access key (e.g. 7k9p2m4x8ab3c5d6)
   * without prefixes, special characters, uppercase letters, or spaces.
   */
  generateAccessKey(length = 16): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let key = '';
    for (let i = 0; i < length; i++) {
      key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return key;
  }

  /**
   * Creates a new access key in the database with an optional user label.
   */
  async createKey(label?: string, customKey?: string) {
    if (!this.prisma) {
      throw new Error('Database service unavailable');
    }
    const key = (customKey || this.generateAccessKey()).trim().toLowerCase();
    const record = await this.prisma.catcastKey.create({
      data: {
        key,
        label: label?.trim() || null,
        isActive: true,
      },
    });
    this.logger.log(
      `Created new CatCast access key "${record.key.slice(0, 4)}***" for "${record.label || 'Unknown'}"`
    );
    return record;
  }

  /**
   * Lists all access keys stored in the database.
   */
  async listKeys() {
    if (!this.prisma) return [];
    return this.prisma.catcastKey.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Resets device binding for a key (by ID or key string), allowing re-pairing on a new device.
   */
  async resetKeyBinding(identifier: string | number) {
    const isId = typeof identifier === 'number' || /^\d+$/.test(identifier.toString());
    const keyRecord = this.prisma
      ? isId
        ? await this.prisma.catcastKey.findUnique({ where: { id: Number(identifier) } })
        : await this.prisma.catcastKey.findUnique({ where: { key: identifier.toString().trim() } })
      : null;

    const targetKey = keyRecord ? keyRecord.key : identifier.toString().trim();

    if (this.prisma && keyRecord) {
      await this.prisma.catcastKey.update({
        where: { id: keyRecord.id },
        data: {
          boundDeviceId: null,
          platform: null,
          lastIp: null,
          createdAt: new Date(), // Reset 24-hour activation window for re-pairing
        },
      });
    }

    await this.resetBinding(targetKey);
    this.logger.log(`Device binding reset for CatCast key "${targetKey.slice(0, 4)}***"`);
    return (
      keyRecord || { id: null, key: targetKey, label: null, boundDeviceId: null, isActive: true }
    );
  }

  /**
   * Toggles the active/blocked status of an access key.
   */
  async toggleKey(identifier: string | number) {
    if (!this.prisma) {
      throw new Error('Database service unavailable');
    }
    const isId = typeof identifier === 'number' || /^\d+$/.test(identifier.toString());
    const keyRecord = isId
      ? await this.prisma.catcastKey.findUnique({ where: { id: Number(identifier) } })
      : await this.prisma.catcastKey.findUnique({ where: { key: identifier.toString().trim() } });

    if (!keyRecord) {
      throw new NotFoundException(`Catcast key "${identifier}" not found`);
    }

    const updated = await this.prisma.catcastKey.update({
      where: { id: keyRecord.id },
      data: {
        isActive: !keyRecord.isActive,
      },
    });

    if (!updated.isActive) {
      // Invalidate cache immediately on deactivation
      await this.resetBinding(updated.key);
    }

    this.logger.log(
      `CatCast key "${updated.key.slice(0, 4)}***" status changed to isActive=${updated.isActive}`
    );
    return updated;
  }

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
    const normalizedIp = this.normalizeIp(clientIp);

    // 1. Check in PostgreSQL database first
    let dbKey = this.prisma
      ? await this.prisma.catcastKey.findUnique({ where: { key: cleanKey } })
      : null;

    // 2. Fallback to legacy environment variable keys if not in DB
    if (!dbKey) {
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

      // If valid in env, auto-import to DB if Prisma is available
      if (this.prisma) {
        try {
          dbKey = await this.prisma.catcastKey.upsert({
            where: { key: cleanKey },
            create: {
              key: cleanKey,
              label: 'Legacy env key',
              isActive: true,
            },
            update: {},
          });
        } catch {
          // ignore auto-import error, continue with in-memory/redis binding
        }
      }
    }

    // 3. Database-backed binding & verification
    if (dbKey) {
      if (!dbKey.isActive) {
        this.logger.warn(`Rejected blocked CatCast key "${cleanKey.slice(0, 4)}***"`);
        throw new UnauthorizedException({
          success: false,
          error: CATCAST_CONSTANTS.ERROR_CODES.INVALID_KEY,
          message: CATCAST_CONSTANTS.ERROR_MESSAGES.INVALID_KEY,
        });
      }

      const now = new Date();

      // First-time binding for this key in DB
      if (!dbKey.boundDeviceId) {
        // Enforce 24-hour activation window from key creation
        const createdAtTime = new Date(dbKey.createdAt).getTime();
        const maxActivationWindowMs = 24 * 60 * 60 * 1000; // 24 hours
        if (now.getTime() - createdAtTime > maxActivationWindowMs) {
          this.logger.warn(
            `CatCast key "${cleanKey.slice(0, 4)}***" activation window expired: created at ${dbKey.createdAt.toISOString()}, attempted at ${now.toISOString()} (> 24 hours)`
          );
          await this.prisma.catcastKey.update({
            where: { id: dbKey.id },
            data: { isActive: false },
          });

          throw new UnauthorizedException({
            success: false,
            error: CATCAST_CONSTANTS.ERROR_CODES.KEY_EXPIRED,
            message: CATCAST_CONSTANTS.ERROR_MESSAGES.KEY_EXPIRED,
          });
        }

        await this.prisma.catcastKey.update({
          where: { id: dbKey.id },
          data: {
            boundDeviceId: cleanDeviceId,
            platform,
            lastIp: normalizedIp,
            activatedAt: dbKey.activatedAt || now,
            lastUsedAt: now,
          },
        });

        await this.setBindingRecord(cleanKey, {
          boundDeviceId: cleanDeviceId,
          platform,
          lastIp: normalizedIp,
          activatedAt: (dbKey.activatedAt || now).toISOString(),
          lastUsedAt: now.toISOString(),
        });

        this.logger.log(
          `Bound CatCast key "${cleanKey.slice(0, 4)}***" to device "${cleanDeviceId}" (${platform})`
        );

        return {
          success: true,
          boundDeviceId: cleanDeviceId,
          isNewBinding: true,
          platform,
        };
      }

      // Case-insensitive comparison of bound device ID
      if (dbKey.boundDeviceId.trim().toLowerCase() !== cleanDeviceId.toLowerCase()) {
        this.logger.warn(
          `CatCast key device mismatch for key "${cleanKey.slice(0, 4)}***": bound to "${dbKey.boundDeviceId}", incoming: "${cleanDeviceId}"`
        );
        throw new ForbiddenException({
          success: false,
          error: CATCAST_CONSTANTS.ERROR_CODES.DEVICE_MISMATCH,
          message: CATCAST_CONSTANTS.ERROR_MESSAGES.DEVICE_MISMATCH,
        });
      }

      // Successful verification from the same bound device
      await this.prisma.catcastKey.update({
        where: { id: dbKey.id },
        data: {
          lastUsedAt: now,
          lastIp: normalizedIp,
          ...(dto?.platform ? { platform: dto.platform.trim() } : {}),
        },
      });

      await this.setBindingRecord(cleanKey, {
        boundDeviceId: dbKey.boundDeviceId,
        platform: dto?.platform?.trim() || dbKey.platform || 'web',
        lastIp: normalizedIp,
        activatedAt: dbKey.activatedAt?.toISOString() || now.toISOString(),
        lastUsedAt: now.toISOString(),
      });

      return {
        success: true,
        boundDeviceId: dbKey.boundDeviceId,
        isNewBinding: false,
        platform: dto?.platform?.trim() || dbKey.platform || 'web',
      };
    }

    // 4. Fallback Redis/In-memory path (when running without Prisma/DB)
    const existingRecord = await this.getBindingRecord(cleanKey);

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

    // Check device binding (case-insensitive)
    if (existingRecord.boundDeviceId.trim().toLowerCase() !== cleanDeviceId.toLowerCase()) {
      this.logger.warn(
        `Catcast key device mismatch for key "${cleanKey.slice(0, 4)}***": bound to "${existingRecord.boundDeviceId}", incoming: "${cleanDeviceId}"`
      );
      throw new ForbiddenException({
        success: false,
        error: CATCAST_CONSTANTS.ERROR_CODES.DEVICE_MISMATCH,
        message: CATCAST_CONSTANTS.ERROR_MESSAGES.DEVICE_MISMATCH,
      });
    }

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
    let clean = (ip || '').trim();
    if (clean.includes(',')) {
      clean = clean.split(',')[0].trim();
    }
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
      await this.redisReader.delete(legacyRedisKey);
    } catch (err: any) {
      this.logger.warn(`Failed writing bound device to redis: ${err?.message}`);
    }
  }
}
