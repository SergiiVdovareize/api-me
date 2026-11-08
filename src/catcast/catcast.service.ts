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

export interface CreateDeviceRequestDto {
  deviceId: string;
  platform: string;
  model?: string;
  os?: string;
}

export interface DeviceRequestResponse {
  requestId?: string | null;
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'unknown';
  expiresAt?: string | null;
  error?: string;
  message?: string;
}

export interface DeviceStatusResponse {
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'unknown';
  expiresAt: string | null;
  requestId: string | null;
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
  private deviceRequestNotifier?: (
    request: any
  ) => Promise<{ messageId?: number; chatId?: string } | void>;

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

  /**
   * Registers a notifier function (e.g. from TelegramService) called when a new device request arrives.
   */
  setDeviceRequestNotifier(
    notifier: (request: any) => Promise<{ messageId?: number; chatId?: string } | void>
  ): void {
    this.deviceRequestNotifier = notifier;
  }

  /**
   * Creates or retrieves a pending device access request, enforcing:
   * 1. Immediate approval if already in allowlist
   * 2. Idempotent return of active pending request (30 min TTL)
   * 3. Rate limiting (max 5 new requests per deviceId per hour)
   * 4. Notification to admin via Telegram
   */
  async requestDeviceAccess(dto: CreateDeviceRequestDto): Promise<DeviceRequestResponse> {
    const cleanDeviceId = dto?.deviceId?.trim();
    if (!cleanDeviceId) {
      throw new BadRequestException('deviceId is required');
    }
    if (!this.prisma) {
      throw new Error('Database service unavailable');
    }
    const cleanPlatform = dto.platform?.trim() || 'unknown';

    // 1. Check if device is already approved in allowlist
    const allowed = await this.prisma.catcastDevice.findUnique({
      where: { deviceId: cleanDeviceId },
    });
    if (allowed && allowed.isAllowed) {
      return {
        requestId: null,
        status: CATCAST_CONSTANTS.DEVICE_STATUS.APPROVED,
      };
    }

    const now = new Date();

    // 2. Check for an existing live pending request
    const live = await this.prisma.catcastDeviceRequest.findFirst({
      where: {
        deviceId: cleanDeviceId,
        status: CATCAST_CONSTANTS.DEVICE_STATUS.PENDING,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (live) {
      return {
        requestId: live.id,
        status: CATCAST_CONSTANTS.DEVICE_STATUS.PENDING,
        expiresAt: live.expiresAt.toISOString(),
      };
    }

    // 3. Rate limiting: max 5 new requests per deviceId per hour
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const countLastHour = await this.prisma.catcastDeviceRequest.count({
      where: {
        deviceId: cleanDeviceId,
        createdAt: { gte: oneHourAgo },
      },
    });

    if (countLastHour >= CATCAST_CONSTANTS.DEVICE_REQUEST.RATE_LIMIT_HOURLY) {
      return {
        error: CATCAST_CONSTANTS.ERROR_CODES.RATE_LIMIT,
        status: CATCAST_CONSTANTS.DEVICE_STATUS.DENIED,
        message: 'Забагато заявок. Спробуйте пізніше',
      };
    }

    // 4. Create new pending request with 30 min lifetime
    const expiresAt = new Date(
      now.getTime() + CATCAST_CONSTANTS.DEVICE_REQUEST.TTL_MINUTES * 60 * 1000
    );
    const model = dto.model ? dto.model.trim().slice(0, 120) : null;
    const os = dto.os ? dto.os.trim().slice(0, 80) : null;

    const newRecord = await this.prisma.catcastDeviceRequest.create({
      data: {
        deviceId: cleanDeviceId,
        platform: cleanPlatform,
        model,
        os,
        status: CATCAST_CONSTANTS.DEVICE_STATUS.PENDING,
        expiresAt,
      },
    });

    // 5. Notify admin via Telegram
    if (this.deviceRequestNotifier) {
      try {
        const sent = await this.deviceRequestNotifier(newRecord);
        if (sent && sent.messageId) {
          await this.prisma.catcastDeviceRequest.update({
            where: { id: newRecord.id },
            data: {
              telegramMessageId: sent.messageId,
              telegramChatId: sent.chatId ? String(sent.chatId) : null,
            },
          });
        }
      } catch (err: any) {
        this.logger.error(
          `Failed to notify Telegram about device request "${newRecord.id}": ${err.message}`
        );
      }
    }

    return {
      requestId: newRecord.id,
      status: CATCAST_CONSTANTS.DEVICE_STATUS.PENDING,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Retrieves current device status for polling.
   */
  async getDeviceStatus(deviceId?: string): Promise<DeviceStatusResponse> {
    const cleanDeviceId = deviceId?.trim();
    if (!cleanDeviceId || !this.prisma) {
      return { status: CATCAST_CONSTANTS.DEVICE_STATUS.UNKNOWN, expiresAt: null, requestId: null };
    }

    try {
      // 1. Check allowlist
      const allowed = await this.prisma.catcastDevice.findUnique({
        where: { deviceId: cleanDeviceId },
      });
      if (allowed && allowed.isAllowed) {
        return {
          status: CATCAST_CONSTANTS.DEVICE_STATUS.APPROVED,
          expiresAt: null,
          requestId: null,
        };
      }

      // 2. Check latest request
      const latest = await this.prisma.catcastDeviceRequest.findFirst({
        where: { deviceId: cleanDeviceId },
        orderBy: { createdAt: 'desc' },
      });

      if (!latest) {
        return {
          status: CATCAST_CONSTANTS.DEVICE_STATUS.UNKNOWN,
          expiresAt: null,
          requestId: null,
        };
      }

      if (latest.status === CATCAST_CONSTANTS.DEVICE_STATUS.APPROVED) {
        return {
          status: CATCAST_CONSTANTS.DEVICE_STATUS.APPROVED,
          expiresAt: null,
          requestId: latest.id,
        };
      }

      if (latest.status === CATCAST_CONSTANTS.DEVICE_STATUS.DENIED) {
        return {
          status: CATCAST_CONSTANTS.DEVICE_STATUS.DENIED,
          expiresAt: null,
          requestId: latest.id,
        };
      }

      if (latest.status === CATCAST_CONSTANTS.DEVICE_STATUS.PENDING) {
        const now = new Date();
        if (now <= new Date(latest.expiresAt)) {
          return {
            status: CATCAST_CONSTANTS.DEVICE_STATUS.PENDING,
            expiresAt: new Date(latest.expiresAt).toISOString(),
            requestId: latest.id,
          };
        }
        return {
          status: CATCAST_CONSTANTS.DEVICE_STATUS.EXPIRED,
          expiresAt: new Date(latest.expiresAt).toISOString(),
          requestId: latest.id,
        };
      }

      return {
        status: CATCAST_CONSTANTS.DEVICE_STATUS.UNKNOWN,
        expiresAt: null,
        requestId: latest.id,
      };
    } catch (err: any) {
      this.logger.warn(`Failed to retrieve device status for "${cleanDeviceId}": ${err.message}`);
      return { status: CATCAST_CONSTANTS.DEVICE_STATUS.UNKNOWN, expiresAt: null, requestId: null };
    }
  }

  /**
   * Approves a device request, adding the device to the allowlist.
   */
  async approveDeviceRequest(requestId: string, adminInfo?: string) {
    if (!this.prisma) {
      throw new Error('Database service unavailable');
    }

    const req = await this.prisma.catcastDeviceRequest.findUnique({
      where: { id: requestId },
    });
    if (!req) {
      throw new NotFoundException(`Device request "${requestId}" not found`);
    }

    if (req.status !== CATCAST_CONSTANTS.DEVICE_STATUS.PENDING) {
      return {
        success: true,
        alreadyProcessed: true,
        request: req,
      };
    }

    const updatedReq = await this.prisma.catcastDeviceRequest.update({
      where: { id: requestId },
      data: { status: CATCAST_CONSTANTS.DEVICE_STATUS.APPROVED },
    });

    const device = await this.prisma.catcastDevice.upsert({
      where: { deviceId: req.deviceId },
      create: {
        deviceId: req.deviceId,
        platform: req.platform,
        model: req.model,
        os: req.os,
        isAllowed: true,
      },
      update: {
        platform: req.platform,
        model: req.model,
        os: req.os,
        isAllowed: true,
      },
    });

    this.logger.log(`Device "${req.deviceId}" approved by ${adminInfo || 'admin'}`);

    return {
      success: true,
      alreadyProcessed: false,
      request: updatedReq,
      device,
    };
  }

  /**
   * Denies a device request.
   */
  async denyDeviceRequest(requestId: string, adminInfo?: string) {
    if (!this.prisma) {
      throw new Error('Database service unavailable');
    }

    const req = await this.prisma.catcastDeviceRequest.findUnique({
      where: { id: requestId },
    });
    if (!req) {
      throw new NotFoundException(`Device request "${requestId}" not found`);
    }

    if (req.status !== CATCAST_CONSTANTS.DEVICE_STATUS.PENDING) {
      return {
        success: true,
        alreadyProcessed: true,
        request: req,
      };
    }

    const updatedReq = await this.prisma.catcastDeviceRequest.update({
      where: { id: requestId },
      data: { status: CATCAST_CONSTANTS.DEVICE_STATUS.DENIED },
    });

    await this.prisma.catcastDevice.updateMany({
      where: { deviceId: req.deviceId },
      data: { isAllowed: false },
    });

    this.logger.log(
      `Device request "${requestId}" (${req.deviceId}) denied by ${adminInfo || 'admin'}`
    );

    return {
      success: true,
      alreadyProcessed: false,
      request: updatedReq,
    };
  }

  /**
   * Lists all devices currently allowed in allowlist.
   */
  async listAllowedDevices() {
    if (!this.prisma) return [];
    return this.prisma.catcastDevice.findMany({
      where: { isAllowed: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * Revokes allowlist access for a device by its ID or deviceId string.
   */
  async revokeDeviceAccess(identifier: string | number) {
    if (!this.prisma) {
      throw new Error('Database service unavailable');
    }
    const isId = typeof identifier === 'number' || /^\d+$/.test(identifier.toString());
    const device = isId
      ? await this.prisma.catcastDevice.findUnique({ where: { id: Number(identifier) } })
      : await this.prisma.catcastDevice.findUnique({
          where: { deviceId: identifier.toString().trim() },
        });

    if (!device) {
      throw new NotFoundException(`Device "${identifier}" not found`);
    }

    const updated = await this.prisma.catcastDevice.update({
      where: { id: device.id },
      data: { isAllowed: false },
    });

    this.logger.log(`Device access revoked for deviceId "${device.deviceId}"`);
    return updated;
  }
}
