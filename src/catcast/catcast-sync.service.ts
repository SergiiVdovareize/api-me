import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../models/prisma/prisma.service';
import { RedisReader } from '../common/helpers/redisReader';
import { CATCAST_SYNC_CONSTANTS } from './catcast-sync.constants';
import { CatcastSyncContext, hashSyncToken } from './catcast-sync.guard';
import { formatDeviceLocation, RequestDeviceMetadata } from './catcast-device-meta.util';
import {
  InitProfileDto,
  PairAcceptDto,
  PairConfirmDto,
  PairInitDto,
  SyncFavoriteItemDto,
  SyncHistoryItemDto,
  SyncPushDto,
} from './dto/catcast-sync.dto';

export interface DeviceSummary {
  deviceId: string;
  deviceName: string | null;
  platform: string;
  model: string | null;
  os: string | null;
  browser: string | null;
  city: string | null;
  country: string | null;
  location: string | null;
  label: string;
}

export interface PairSession {
  status: 'pending' | 'awaiting_acceptance' | 'confirmed' | 'rejected';
  code: string;
  pairSecret: string;
  targetDeviceId: string;
  targetDeviceSummary: DeviceSummary;
  initiatorProfileId?: string;
  initiatorDeviceSummary?: DeviceSummary;
  syncToken?: string;
  expiresAt: string;
}

export interface DevicePairedNotification {
  profileId: string;
  initiatorDevice: DeviceSummary;
  targetDevice: DeviceSummary;
}

export function buildDeviceLabel(device: {
  deviceName?: string | null;
  model?: string | null;
  platform: string;
  os?: string | null;
  browser?: string | null;
}): string {
  const main = device.deviceName || device.model || device.platform;
  const details = [device.os, device.browser].filter(Boolean).join(', ');
  return details ? `${main} (${details})` : main;
}

export function buildDeviceSummary(device: {
  deviceId: string;
  deviceName?: string | null;
  platform: string;
  model?: string | null;
  os?: string | null;
  browser?: string | null;
  city?: string | null;
  country?: string | null;
}): DeviceSummary {
  const city = device.city ?? null;
  const country = device.country ?? null;
  return {
    deviceId: device.deviceId,
    deviceName: device.deviceName ?? null,
    platform: device.platform,
    model: device.model ?? null,
    os: device.os ?? null,
    browser: device.browser ?? null,
    city,
    country,
    location: formatDeviceLocation(city, country),
    label: buildDeviceLabel(device),
  };
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

@Injectable()
export class CatcastSyncService {
  private readonly logger = new Logger(CatcastSyncService.name);
  private devicePairedNotifier?: (notification: DevicePairedNotification) => Promise<void>;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly redisReader?: RedisReader
  ) {}

  setDevicePairedNotifier(
    notifier: (notification: DevicePairedNotification) => Promise<void>
  ): void {
    this.devicePairedNotifier = notifier;
  }

  private async enforceRateLimit(
    action: string,
    subject: string,
    config: { limit: number; windowSeconds: number }
  ): Promise<void> {
    const redis = this.redisReader?.redis;
    if (!redis) return;

    const key = CATCAST_SYNC_CONSTANTS.REDIS_KEYS.rateLimit(action, subject);
    try {
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, config.windowSeconds);
      }
      if (count > config.limit) {
        throw new HttpException(
          {
            error: CATCAST_SYNC_CONSTANTS.ERROR_CODES.RATE_LIMIT,
            message: 'Too many requests. Please try again later.',
          },
          HttpStatus.TOO_MANY_REQUESTS
        );
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.warn(`Rate limit check failed for ${action}: ${(err as Error).message}`);
    }
  }

  private generatePairCode(): string {
    const bytes = randomBytes(CATCAST_SYNC_CONSTANTS.PAIR_CODE_LENGTH);
    const alphabet = CATCAST_SYNC_CONSTANTS.PAIR_CODE_ALPHABET;
    let code = '';
    for (let i = 0; i < CATCAST_SYNC_CONSTANTS.PAIR_CODE_LENGTH; i++) {
      code += alphabet[bytes[i] % alphabet.length];
    }
    return code;
  }

  private generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  private async getAllowedDeviceOrThrow(deviceId: string) {
    const cleanId = deviceId?.trim();
    if (!cleanId) {
      throw new BadRequestException('deviceId is required');
    }

    const device = await this.prisma.catcastDevice.findUnique({
      where: { deviceId: cleanId },
    });

    if (!device || !device.isAllowed) {
      throw new UnauthorizedException({
        error: CATCAST_SYNC_CONSTANTS.ERROR_CODES.DEVICE_NOT_ALLOWED,
        message: 'Device access is not allowed',
      });
    }

    return device;
  }

  private buildMetadataUpdate(
    current: {
      city?: string | null;
      country?: string | null;
      browser?: string | null;
      os?: string | null;
      model?: string | null;
    },
    meta?: RequestDeviceMetadata
  ): Record<string, string> {
    if (!meta) return {};
    const updates: Record<string, string> = {};
    if (meta.city && meta.city !== current.city) updates.city = meta.city;
    if (meta.country && meta.country !== current.country) updates.country = meta.country;
    if (meta.browser && meta.browser !== current.browser) updates.browser = meta.browser;
    if (meta.os && meta.os !== current.os) updates.os = meta.os;
    if (meta.model && meta.model !== current.model) updates.model = meta.model;
    return updates;
  }

  private syncDeviceMetadataInBackground(
    ctx: CatcastSyncContext,
    meta?: RequestDeviceMetadata
  ): void {
    const updates = this.buildMetadataUpdate(ctx, meta);
    if (Object.keys(updates).length === 0) return;
    this.prisma.catcastDevice
      .update({
        where: { deviceId: ctx.deviceId },
        data: updates,
      })
      .catch(err => {
        this.logger.warn(`Failed to update metadata for ${ctx.deviceId}: ${err.message}`);
      });
  }

  async initProfile(dto: InitProfileDto, clientIp: string, meta?: RequestDeviceMetadata) {
    await this.enforceRateLimit(
      'profile_init',
      `${clientIp}:${dto.deviceId}`,
      CATCAST_SYNC_CONSTANTS.RATE_LIMITS.PROFILE_INIT
    );

    const device = await this.getAllowedDeviceOrThrow(dto.deviceId);
    const syncToken = this.generateToken();
    const syncTokenHash = hashSyncToken(syncToken);
    const deviceName = dto.deviceName?.trim().slice(0, 120) || device.deviceName;
    const browser = dto.browser?.trim().slice(0, 80) || meta?.browser || device.browser;
    const os = meta?.os || device.os;
    const model = meta?.model || device.model;
    const city = meta?.city || device.city;
    const country = meta?.country || device.country;

    if (device.profileId) {
      await this.prisma.catcastDevice.update({
        where: { id: device.id },
        data: {
          syncTokenHash,
          deviceName,
          browser,
          os,
          model,
          city,
          country,
          syncLastSeenAt: new Date(),
        },
      });
      return {
        profileId: device.profileId,
        syncToken,
        serverTs: Date.now(),
      };
    }

    const profile = await this.prisma.$transaction(async tx => {
      const created = await tx.catcastProfile.create({ data: {} });
      await tx.catcastDevice.update({
        where: { id: device.id },
        data: {
          profileId: created.id,
          syncTokenHash,
          deviceName,
          browser,
          os,
          model,
          city,
          country,
          syncLastSeenAt: new Date(),
        },
      });
      return created;
    });

    return {
      profileId: profile.id,
      syncToken,
      serverTs: Date.now(),
    };
  }

  async pairInit(dto: PairInitDto, clientIp: string, meta?: RequestDeviceMetadata) {
    await this.enforceRateLimit(
      'pair_init',
      clientIp,
      CATCAST_SYNC_CONSTANTS.RATE_LIMITS.PAIR_INIT
    );

    if (!this.redisReader) {
      throw new Error('Redis service unavailable');
    }

    const device = await this.getAllowedDeviceOrThrow(dto.deviceId);
    const deviceName = dto.deviceName?.trim().slice(0, 120) || device.deviceName;
    const browser = dto.browser?.trim().slice(0, 80) || meta?.browser || device.browser;
    const os = meta?.os || device.os;
    const model = meta?.model || device.model;
    const city = meta?.city || device.city;
    const country = meta?.country || device.country;

    if (
      deviceName !== device.deviceName ||
      browser !== device.browser ||
      os !== device.os ||
      model !== device.model ||
      city !== device.city ||
      country !== device.country
    ) {
      await this.prisma.catcastDevice.update({
        where: { id: device.id },
        data: { deviceName, browser, os, model, city, country },
      });
    }

    let code = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = this.generatePairCode();
      const existing = await this.redisReader.read(
        CATCAST_SYNC_CONSTANTS.REDIS_KEYS.pairSession(candidate)
      );
      if (!existing) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      throw new Error('Failed to generate unique pairing code');
    }

    const pairSecret = this.generateToken();
    const expiresAt = new Date(
      Date.now() + CATCAST_SYNC_CONSTANTS.PAIR_TTL_SECONDS * 1000
    ).toISOString();

    const session: PairSession = {
      status: 'pending',
      code,
      pairSecret,
      targetDeviceId: device.deviceId,
      targetDeviceSummary: buildDeviceSummary({
        ...device,
        deviceName,
        browser,
        os,
        model,
        city,
        country,
      }),
      expiresAt,
    };

    await this.redisReader.write(
      CATCAST_SYNC_CONSTANTS.REDIS_KEYS.pairSession(code),
      session,
      CATCAST_SYNC_CONSTANTS.PAIR_TTL_SECONDS
    );

    return { code, pairSecret, expiresAt };
  }

  async pairConfirm(ctx: CatcastSyncContext, dto: PairConfirmDto, meta?: RequestDeviceMetadata) {
    this.syncDeviceMetadataInBackground(ctx, meta);
    const enrichedCtx: CatcastSyncContext = {
      ...ctx,
      city: meta?.city || ctx.city,
      country: meta?.country || ctx.country,
      browser: meta?.browser || ctx.browser,
      os: meta?.os || ctx.os,
      model: meta?.model || ctx.model,
    };
    await this.enforceRateLimit(
      'pair_confirm',
      ctx.deviceId,
      CATCAST_SYNC_CONSTANTS.RATE_LIMITS.PAIR_CONFIRM
    );

    if (!this.redisReader) {
      throw new Error('Redis service unavailable');
    }

    const code = dto.code.trim().toUpperCase();
    const attemptsKey = CATCAST_SYNC_CONSTANTS.REDIS_KEYS.pairAttempts(code);
    const redis = this.redisReader.redis;

    if (redis) {
      const attempts = Number((await redis.get(attemptsKey)) || 0);
      if (attempts >= CATCAST_SYNC_CONSTANTS.PAIR_MAX_FAILED_ATTEMPTS) {
        throw new HttpException(
          {
            error: CATCAST_SYNC_CONSTANTS.ERROR_CODES.PAIR_TOO_MANY_ATTEMPTS,
            message: 'Too many failed pairing attempts for this code',
          },
          HttpStatus.TOO_MANY_REQUESTS
        );
      }
    }

    const sessionKey = CATCAST_SYNC_CONSTANTS.REDIS_KEYS.pairSession(code);
    const session = (await this.redisReader.read(sessionKey)) as PairSession | null;

    if (!session) {
      if (redis) {
        const nextAttempts = await redis.incr(attemptsKey);
        if (nextAttempts === 1) {
          await redis.expire(attemptsKey, CATCAST_SYNC_CONSTANTS.PAIR_TTL_SECONDS);
        }
      }
      throw new NotFoundException({
        error: CATCAST_SYNC_CONSTANTS.ERROR_CODES.PAIR_CODE_EXPIRED,
        message: 'Pairing code not found or expired',
      });
    }

    if (session.targetDeviceId === ctx.deviceId) {
      throw new BadRequestException({
        error: CATCAST_SYNC_CONSTANTS.ERROR_CODES.PAIR_CODE_INVALID,
        message: 'Cannot pair a device with itself',
      });
    }

    if (session.status !== 'pending') {
      if (session.initiatorDeviceSummary?.deviceId === ctx.deviceId) {
        return {
          status: session.status,
          targetDevice: session.targetDeviceSummary,
        };
      }
      throw new BadRequestException({
        error: CATCAST_SYNC_CONSTANTS.ERROR_CODES.PAIR_CODE_INVALID,
        message: 'Pairing code is already being processed',
      });
    }

    await this.getAllowedDeviceOrThrow(session.targetDeviceId);

    const updatedSession: PairSession = {
      ...session,
      status: 'awaiting_acceptance',
      initiatorProfileId: enrichedCtx.profileId,
      initiatorDeviceSummary: buildDeviceSummary(enrichedCtx),
    };

    const remainingSeconds = Math.max(
      30,
      Math.ceil((new Date(session.expiresAt).getTime() - Date.now()) / 1000)
    );
    await this.redisReader.write(sessionKey, updatedSession, remainingSeconds);

    return {
      status: 'awaiting_acceptance' as const,
      targetDevice: session.targetDeviceSummary,
    };
  }

  async pairStatus(codeRaw: string, pairSecretRaw: string, clientIp: string) {
    await this.enforceRateLimit(
      'pair_status',
      clientIp,
      CATCAST_SYNC_CONSTANTS.RATE_LIMITS.PAIR_STATUS
    );

    if (!this.redisReader) {
      throw new Error('Redis service unavailable');
    }

    const code = codeRaw?.trim().toUpperCase();
    if (!code || !pairSecretRaw) {
      throw new BadRequestException('code and pairSecret are required');
    }

    const sessionKey = CATCAST_SYNC_CONSTANTS.REDIS_KEYS.pairSession(code);
    const session = (await this.redisReader.read(sessionKey)) as PairSession | null;

    if (!session) {
      return { status: 'expired' as const };
    }

    if (!safeEqual(pairSecretRaw, session.pairSecret)) {
      throw new UnauthorizedException({
        error: CATCAST_SYNC_CONSTANTS.ERROR_CODES.PAIR_CODE_INVALID,
        message: 'Invalid pairSecret',
      });
    }

    if (session.status === 'pending') {
      return {
        status: 'pending' as const,
        expiresAt: session.expiresAt,
      };
    }

    if (session.status === 'awaiting_acceptance') {
      return {
        status: 'awaiting_acceptance' as const,
        peerDevice: session.initiatorDeviceSummary,
        expiresAt: session.expiresAt,
      };
    }

    if (session.status === 'rejected') {
      await this.redisReader.delete(sessionKey);
      return { status: 'rejected' as const };
    }

    // Confirmed: deliver syncToken once and delete the session
    await this.redisReader.delete(sessionKey);
    return {
      status: 'confirmed' as const,
      syncToken: session.syncToken,
      profileId: session.initiatorProfileId,
    };
  }

  async pairAccept(dto: PairAcceptDto, clientIp: string) {
    await this.enforceRateLimit(
      'pair_accept',
      clientIp,
      CATCAST_SYNC_CONSTANTS.RATE_LIMITS.PAIR_ACCEPT
    );

    if (!this.redisReader) {
      throw new Error('Redis service unavailable');
    }

    const code = dto.code.trim().toUpperCase();
    const sessionKey = CATCAST_SYNC_CONSTANTS.REDIS_KEYS.pairSession(code);
    const session = (await this.redisReader.read(sessionKey)) as PairSession | null;

    if (!session) {
      throw new NotFoundException({
        error: CATCAST_SYNC_CONSTANTS.ERROR_CODES.PAIR_CODE_EXPIRED,
        message: 'Pairing code not found or expired',
      });
    }

    if (!safeEqual(dto.pairSecret, session.pairSecret)) {
      throw new UnauthorizedException({
        error: CATCAST_SYNC_CONSTANTS.ERROR_CODES.PAIR_CODE_INVALID,
        message: 'Invalid pairSecret',
      });
    }

    if (session.status === 'confirmed') {
      return {
        status: 'confirmed' as const,
        syncToken: session.syncToken,
        profileId: session.initiatorProfileId,
      };
    }

    if (session.status !== 'awaiting_acceptance' || !session.initiatorProfileId) {
      throw new BadRequestException({
        error: CATCAST_SYNC_CONSTANTS.ERROR_CODES.PAIR_CODE_INVALID,
        message: 'Pairing session is not awaiting acceptance',
      });
    }

    if (!dto.accept) {
      const rejectedSession: PairSession = { ...session, status: 'rejected' };
      await this.redisReader.write(sessionKey, rejectedSession, 60);
      return { status: 'rejected' as const };
    }

    const targetDevice = await this.getAllowedDeviceOrThrow(session.targetDeviceId);
    const syncToken = this.generateToken();
    const syncTokenHash = hashSyncToken(syncToken);
    const targetProfileId = session.initiatorProfileId;
    const sourceProfileId = targetDevice.profileId;

    await this.prisma.$transaction(
      async tx => {
        if (sourceProfileId && sourceProfileId !== targetProfileId) {
          await this.mergeProfilesInTx(tx, targetProfileId, sourceProfileId);
        }

        await tx.catcastDevice.update({
          where: { id: targetDevice.id },
          data: {
            profileId: targetProfileId,
            syncTokenHash,
            syncLastSeenAt: new Date(),
          },
        });
      },
      { maxWait: 5000, timeout: 15000 }
    );

    const confirmedSession: PairSession = {
      ...session,
      status: 'confirmed',
      syncToken,
    };
    await this.redisReader.write(
      sessionKey,
      confirmedSession,
      CATCAST_SYNC_CONSTANTS.PAIR_CONFIRMED_TTL_SECONDS
    );

    if (this.devicePairedNotifier && session.initiatorDeviceSummary) {
      this.devicePairedNotifier({
        profileId: session.initiatorProfileId,
        initiatorDevice: session.initiatorDeviceSummary,
        targetDevice: session.targetDeviceSummary,
      }).catch(err => {
        this.logger.warn(`Failed to send Telegram pairing notification: ${err.message}`);
      });
    }

    return {
      status: 'confirmed' as const,
      syncToken,
      profileId: session.initiatorProfileId,
    };
  }

  /**
   * Merges all devices and sync data from sourceProfileId into targetProfileId,
   * so pairing is symmetric regardless of which device generated or entered the code.
   */
  private async mergeProfilesInTx(
    tx: any,
    targetProfileId: string,
    sourceProfileId: string
  ): Promise<void> {
    const [firstId, secondId] = [targetProfileId, sourceProfileId].sort();
    await tx.$queryRaw`SELECT id FROM "CatcastProfile" WHERE id IN (${firstId}, ${secondId}) ORDER BY id FOR UPDATE`;

    const [targetProfile, sourceProfile] = await Promise.all([
      tx.catcastProfile.findUnique({ where: { id: targetProfileId } }),
      tx.catcastProfile.findUnique({ where: { id: sourceProfileId } }),
    ]);

    if (!targetProfile || !sourceProfile) return;

    const serverNow = Date.now();
    const clampTs = (ts: number) =>
      Math.min(
        Math.max(0, Math.trunc(ts)),
        serverNow + CATCAST_SYNC_CONSTANTS.CLOCK_SKEW_MAX_FUTURE_MS
      );

    // 1. Merge historyClearedTs
    const targetCleared = Number(targetProfile.historyClearedTs);
    const sourceCleared = Number(sourceProfile.historyClearedTs);
    const effectiveClearedTs = Math.max(targetCleared, sourceCleared);

    if (effectiveClearedTs > targetCleared) {
      await tx.catcastProfile.update({
        where: { id: targetProfileId },
        data: { historyClearedTs: BigInt(effectiveClearedTs) },
      });
      await tx.catcastSyncHistory.deleteMany({
        where: { profileId: targetProfileId, ts: { lte: BigInt(effectiveClearedTs) } },
      });
    }

    // 2. Merge history items from source profile
    const sourceHistory = await tx.catcastSyncHistory.findMany({
      where: { profileId: sourceProfileId },
    });
    if (sourceHistory.length > 0) {
      const historyDtos: SyncHistoryItemDto[] = sourceHistory.map((h: any) => ({
        mediaKey: h.mediaKey,
        url: h.url,
        canonicalId: h.canonicalId,
        title: h.title,
        orig: h.orig,
        poster: h.poster,
        season: h.season,
        episode: h.episode,
        episodeName: h.episodeName,
        currentTime: h.currentTime,
        duration: h.duration,
        completed: h.completed,
        watchedEpisodes:
          h.watchedEpisodes && typeof h.watchedEpisodes === 'object'
            ? (h.watchedEpisodes as Record<string, number>)
            : {},
        voice: h.voice,
        ts: Number(h.ts),
      }));
      await this.mergeHistoryBatch(
        tx,
        targetProfileId,
        historyDtos,
        effectiveClearedTs,
        serverNow,
        clampTs
      );
    }

    // 3. Merge favorites from source profile
    const sourceFavorites = await tx.catcastSyncFavorite.findMany({
      where: { profileId: sourceProfileId },
    });
    if (sourceFavorites.length > 0) {
      const favoriteDtos: SyncFavoriteItemDto[] = sourceFavorites.map((f: any) => ({
        mediaKey: f.mediaKey,
        url: f.url,
        canonicalId: f.canonicalId,
        title: f.title,
        orig: f.orig,
        poster: f.poster,
        ts: Number(f.ts),
        deletedAt: f.deletedAt !== null ? Number(f.deletedAt) : null,
      }));
      await this.mergeFavoritesBatch(tx, targetProfileId, favoriteDtos, serverNow, clampTs);
    }

    // 4. Merge searchHistory
    if (Number(sourceProfile.searchUpdatedAt) > Number(targetProfile.searchUpdatedAt)) {
      await tx.catcastProfile.update({
        where: { id: targetProfileId },
        data: {
          searchQueries: sourceProfile.searchQueries,
          searchUpdatedAt: sourceProfile.searchUpdatedAt,
        },
      });
    }

    // 5. Move all other devices from sourceProfileId to targetProfileId (preserving their syncTokens)
    await tx.catcastDevice.updateMany({
      where: { profileId: sourceProfileId },
      data: { profileId: targetProfileId },
    });

    // 6. Remove now-empty source profile
    await tx.catcastProfile.delete({ where: { id: sourceProfileId } });
  }

  async listDevices(ctx: CatcastSyncContext) {
    const devices = await this.prisma.catcastDevice.findMany({
      where: { profileId: ctx.profileId, isAllowed: true },
      orderBy: { syncLastSeenAt: 'desc' },
    });

    return {
      profileId: ctx.profileId,
      devices: devices.map(d => ({
        ...buildDeviceSummary(d),
        syncLastSeenAt: d.syncLastSeenAt?.toISOString() ?? null,
        isCurrent: d.deviceId === ctx.deviceId,
      })),
    };
  }

  async removeDevice(
    ctx: CatcastSyncContext,
    targetDeviceId: string,
    mode: 'unlink' | 'revoke' = 'unlink'
  ) {
    const cleanId = targetDeviceId?.trim();
    if (!cleanId) {
      throw new BadRequestException('deviceId is required');
    }

    if (mode === 'revoke' && cleanId === ctx.deviceId) {
      throw new BadRequestException({
        error: CATCAST_SYNC_CONSTANTS.ERROR_CODES.CANNOT_REVOKE_CURRENT_DEVICE,
        message: 'Cannot revoke access of the currently active device',
      });
    }

    const device = await this.prisma.catcastDevice.findFirst({
      where: { deviceId: cleanId, profileId: ctx.profileId },
    });

    if (!device) {
      throw new NotFoundException(`Device "${cleanId}" not found in this profile`);
    }

    await this.prisma.catcastDevice.update({
      where: { id: device.id },
      data: {
        profileId: null,
        syncTokenHash: null,
        ...(mode === 'revoke' ? { isAllowed: false } : {}),
      },
    });

    return {
      success: true,
      deviceId: cleanId,
      mode,
    };
  }

  private sanitizeWatchedEpisodes(
    raw: Record<string, number> | undefined,
    clampTs: (ts: number) => number
  ): Record<string, number> {
    if (!raw || typeof raw !== 'object') return {};
    const entries = Object.entries(raw)
      .filter(
        ([key, val]) =>
          typeof key === 'string' && key.length <= 32 && typeof val === 'number' && val >= 0
      )
      .map(([key, val]) => [key, clampTs(Math.trunc(val))] as const);

    if (entries.length > CATCAST_SYNC_CONSTANTS.WATCHED_EPISODES_MAX_KEYS) {
      entries.sort((a, b) => b[1] - a[1]);
      entries.length = CATCAST_SYNC_CONSTANTS.WATCHED_EPISODES_MAX_KEYS;
    }

    return Object.fromEntries(entries);
  }

  private mergeWatchedEpisodes(
    existingRaw: unknown,
    incoming: Record<string, number>
  ): { merged: Record<string, number>; changed: boolean } {
    const existing =
      existingRaw && typeof existingRaw === 'object' ? (existingRaw as Record<string, number>) : {};
    const merged: Record<string, number> = { ...existing };
    let changed = false;

    for (const [epKey, incTs] of Object.entries(incoming)) {
      const prevTs = merged[epKey];
      if (prevTs === undefined || incTs > prevTs) {
        merged[epKey] = incTs;
        changed = true;
      }
    }

    return { merged, changed };
  }

  private hashObject(obj: unknown): string {
    return createHash('sha256').update(JSON.stringify(obj)).digest('hex');
  }

  private parseOptionalInt(value: unknown, min = 0, max = 100000): number | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
      const n = Math.trunc(value);
      return n >= min && n <= max ? n : null;
    }
    if (typeof value === 'string') {
      const match = value.match(/\d+/);
      if (match) {
        const n = Number(match[0]);
        if (Number.isFinite(n) && n >= min && n <= max) return n;
      }
      return null;
    }
    throw new BadRequestException('Invalid integer field in sync payload');
  }

  private parseNonNegativeInt(value: unknown, fallback = 0): number {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(0, Math.trunc(value));
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return Math.max(0, Math.trunc(parsed));
    }
    throw new BadRequestException('Invalid numeric field in sync payload');
  }

  private clampStr(value: unknown, maxLen: number): string | undefined {
    if (value === undefined || value === null) return undefined;
    return String(value).slice(0, maxLen);
  }

  async push(ctx: CatcastSyncContext, dto: SyncPushDto, meta?: RequestDeviceMetadata) {
    this.syncDeviceMetadataInBackground(ctx, meta);
    if (dto.history && dto.history.length > CATCAST_SYNC_CONSTANTS.HISTORY_LIMIT) {
      throw new BadRequestException(
        `history exceeds maximum of ${CATCAST_SYNC_CONSTANTS.HISTORY_LIMIT} items`
      );
    }
    if (dto.favorites && dto.favorites.length > CATCAST_SYNC_CONSTANTS.FAVORITES_LIMIT) {
      throw new BadRequestException(
        `favorites exceeds maximum of ${CATCAST_SYNC_CONSTANTS.FAVORITES_LIMIT} items`
      );
    }

    await this.enforceRateLimit('push', ctx.profileId, CATCAST_SYNC_CONSTANTS.RATE_LIMITS.PUSH);

    return this.prisma.$transaction(
      async tx => {
        await tx.$queryRaw`SELECT id FROM "CatcastProfile" WHERE id = ${ctx.profileId} FOR UPDATE`;

        const profile = await tx.catcastProfile.findUnique({
          where: { id: ctx.profileId },
        });

        if (!profile) {
          throw new NotFoundException('Sync profile not found');
        }

        const serverNow = Date.now();
        const clampTs = (ts: number) =>
          Math.min(
            Math.max(0, Math.trunc(ts)),
            serverNow + CATCAST_SYNC_CONSTANTS.CLOCK_SKEW_MAX_FUTURE_MS
          );

        let effectiveClearedTs = Number(profile.historyClearedTs);
        if (dto.historyClearedTs !== undefined) {
          const clampedCleared = clampTs(dto.historyClearedTs);
          if (clampedCleared > effectiveClearedTs) {
            effectiveClearedTs = clampedCleared;
            await tx.catcastProfile.update({
              where: { id: ctx.profileId },
              data: { historyClearedTs: BigInt(effectiveClearedTs) },
            });
            await tx.catcastSyncHistory.deleteMany({
              where: {
                profileId: ctx.profileId,
                ts: { lte: BigInt(effectiveClearedTs) },
              },
            });
          }
        }

        if (dto.history && dto.history.length > 0) {
          await this.mergeHistoryBatch(
            tx,
            ctx.profileId,
            dto.history,
            effectiveClearedTs,
            serverNow,
            clampTs
          );
        }

        if (dto.favorites && dto.favorites.length > 0) {
          await this.mergeFavoritesBatch(tx, ctx.profileId, dto.favorites, serverNow, clampTs);
        }

        if (dto.searchHistory) {
          const incomingUpdatedAt = clampTs(dto.searchHistory.updatedAt);
          if (incomingUpdatedAt > Number(profile.searchUpdatedAt)) {
            const cleanQueries = dto.searchHistory.queries
              .map(q => q.trim())
              .filter(q => q.length >= CATCAST_SYNC_CONSTANTS.SEARCH_QUERY_MIN_LENGTH)
              .slice(0, CATCAST_SYNC_CONSTANTS.SEARCH_QUERIES_LIMIT);

            await tx.catcastProfile.update({
              where: { id: ctx.profileId },
              data: {
                searchQueries: cleanQueries,
                searchUpdatedAt: BigInt(incomingUpdatedAt),
              },
            });
          }
        }

        return { serverTs: serverNow };
      },
      { maxWait: 5000, timeout: 15000 }
    );
  }

  private async mergeHistoryBatch(
    tx: any,
    profileId: string,
    items: SyncHistoryItemDto[],
    effectiveClearedTs: number,
    serverNow: number,
    clampTs: (ts: number) => number
  ): Promise<void> {
    const validItems = items
      .filter(item => item && typeof item.mediaKey === 'string' && item.mediaKey.trim() !== '')
      .map(item => ({
        ...item,
        mediaKey: item.mediaKey.trim().slice(0, 256),
        url: this.clampStr(item.url, 512),
        canonicalId: this.clampStr(item.canonicalId, 128),
        title: this.clampStr(item.title, 512),
        orig: this.clampStr(item.orig, 512),
        poster: this.clampStr(item.poster, 1024),
        season: this.parseOptionalInt(item.season, 0, 10000),
        episode: this.parseOptionalInt(item.episode, 0, 100000),
        episodeName: this.clampStr(item.episodeName, 256),
        currentTime:
          item.currentTime !== undefined
            ? this.parseNonNegativeInt(item.currentTime, 0)
            : undefined,
        duration:
          item.duration !== undefined ? this.parseNonNegativeInt(item.duration, 0) : undefined,
        completed: item.completed !== undefined ? Boolean(item.completed) : undefined,
        voice: this.clampStr(item.voice, 256),
        clampedTs: clampTs(this.parseNonNegativeInt(item.ts, 0)),
        sanitizedWatched: this.sanitizeWatchedEpisodes(item.watchedEpisodes, clampTs),
      }))
      .filter(item => item.clampedTs > effectiveClearedTs);

    if (validItems.length === 0) return;

    const mediaKeys = validItems.map(i => i.mediaKey);
    const existingRows = await tx.catcastSyncHistory.findMany({
      where: { profileId, mediaKey: { in: mediaKeys } },
    });
    const existingMap = new Map<string, any>(existingRows.map((r: any) => [r.mediaKey, r]));
    const toCreate = new Map<string, any>();
    const toUpdate = new Map<number, any>();

    for (const item of validItems) {
      const existing = existingMap.get(item.mediaKey);
      if (!existing) {
        const pendingCreate = toCreate.get(item.mediaKey);
        if (!pendingCreate) {
          toCreate.set(item.mediaKey, {
            profileId,
            mediaKey: item.mediaKey,
            url: item.url ?? '',
            canonicalId: item.canonicalId ?? '',
            title: item.title ?? '',
            orig: item.orig ?? '',
            poster: item.poster ?? '',
            season: item.season ?? null,
            episode: item.episode ?? null,
            episodeName: item.episodeName ?? '',
            currentTime: item.currentTime ?? 0,
            duration: item.duration ?? 0,
            completed: item.completed ?? false,
            watchedEpisodes: item.sanitizedWatched,
            voice: item.voice ?? '',
            ts: BigInt(item.clampedTs),
            updatedOnServerAt: BigInt(serverNow),
          });
        } else {
          const { merged } = this.mergeWatchedEpisodes(
            pendingCreate.watchedEpisodes,
            item.sanitizedWatched
          );
          if (item.clampedTs > Number(pendingCreate.ts)) {
            toCreate.set(item.mediaKey, {
              ...pendingCreate,
              url: item.url ?? pendingCreate.url,
              canonicalId: item.canonicalId ?? pendingCreate.canonicalId,
              title: item.title ?? pendingCreate.title,
              orig: item.orig ?? pendingCreate.orig,
              poster: item.poster ?? pendingCreate.poster,
              season: item.season !== undefined ? item.season : pendingCreate.season,
              episode: item.episode !== undefined ? item.episode : pendingCreate.episode,
              episodeName: item.episodeName ?? pendingCreate.episodeName,
              currentTime: item.currentTime ?? pendingCreate.currentTime,
              duration: item.duration ?? pendingCreate.duration,
              completed: item.completed ?? pendingCreate.completed,
              voice: item.voice ?? pendingCreate.voice,
              ts: BigInt(item.clampedTs),
              watchedEpisodes: merged,
            });
          } else {
            pendingCreate.watchedEpisodes = merged;
          }
        }
        continue;
      }

      const { merged: mergedWatched, changed: watchedChanged } = this.mergeWatchedEpisodes(
        existing.watchedEpisodes,
        item.sanitizedWatched
      );

      const isNewer = item.clampedTs > Number(existing.ts);
      if (!isNewer && !watchedChanged) {
        continue;
      }

      const nextData = isNewer
        ? {
            url: item.url ?? existing.url,
            canonicalId: item.canonicalId ?? existing.canonicalId,
            title: item.title ?? existing.title,
            orig: item.orig ?? existing.orig,
            poster: item.poster ?? existing.poster,
            season: item.season !== undefined ? item.season : existing.season,
            episode: item.episode !== undefined ? item.episode : existing.episode,
            episodeName: item.episodeName ?? existing.episodeName,
            currentTime: item.currentTime ?? existing.currentTime,
            duration: item.duration ?? existing.duration,
            completed: item.completed ?? existing.completed,
            voice: item.voice ?? existing.voice,
            ts: BigInt(item.clampedTs),
            watchedEpisodes: mergedWatched,
          }
        : {
            watchedEpisodes: mergedWatched,
          };

      // Idempotency check: only bump updatedOnServerAt if something actually changed
      const prevComparable = {
        url: existing.url,
        canonicalId: existing.canonicalId,
        title: existing.title,
        orig: existing.orig,
        poster: existing.poster,
        season: existing.season,
        episode: existing.episode,
        episodeName: existing.episodeName,
        currentTime: existing.currentTime,
        duration: existing.duration,
        completed: existing.completed,
        voice: existing.voice,
        ts: Number(existing.ts),
        watchedEpisodes: existing.watchedEpisodes,
      };
      const nextComparable = {
        ...prevComparable,
        ...nextData,
        ts: isNewer ? item.clampedTs : Number(existing.ts),
      };

      if (this.hashObject(prevComparable) === this.hashObject(nextComparable)) {
        continue;
      }

      const updatePayload = {
        ...nextData,
        updatedOnServerAt: BigInt(serverNow),
      };
      existingMap.set(item.mediaKey, { ...existing, ...updatePayload });
      toUpdate.set(existing.id, updatePayload);
    }

    if (toCreate.size > 0) {
      await tx.catcastSyncHistory.createMany({
        data: Array.from(toCreate.values()),
        skipDuplicates: true,
      });
    }

    if (toUpdate.size > 0) {
      await Promise.all(
        Array.from(toUpdate.entries()).map(([id, data]) =>
          tx.catcastSyncHistory.update({ where: { id }, data })
        )
      );
    }

    // Trim history to max 200 newest items
    const overflow = await tx.catcastSyncHistory.findMany({
      where: { profileId },
      orderBy: [{ ts: 'desc' }, { id: 'desc' }],
      skip: CATCAST_SYNC_CONSTANTS.HISTORY_LIMIT,
      select: { id: true },
    });

    if (overflow.length > 0) {
      await tx.catcastSyncHistory.deleteMany({
        where: { id: { in: overflow.map((o: any) => o.id) } },
      });
    }
  }

  private async mergeFavoritesBatch(
    tx: any,
    profileId: string,
    items: SyncFavoriteItemDto[],
    serverNow: number,
    clampTs: (ts: number) => number
  ): Promise<void> {
    const mediaKeys = items.map(i => i.mediaKey);
    const existingRows = await tx.catcastSyncFavorite.findMany({
      where: { profileId, mediaKey: { in: mediaKeys } },
    });
    const existingMap = new Map<string, any>(existingRows.map((r: any) => [r.mediaKey, r]));
    const toCreate = new Map<string, any>();
    const toUpdate = new Map<number, any>();

    for (const item of items) {
      const clampedTs = clampTs(item.ts);
      const clampedDeletedAt =
        item.deletedAt !== undefined && item.deletedAt !== null ? clampTs(item.deletedAt) : null;
      const incomingActionTs = Math.max(clampedTs, clampedDeletedAt ?? 0);

      const existing = existingMap.get(item.mediaKey);
      if (!existing) {
        const pendingCreate = toCreate.get(item.mediaKey);
        const pendingActionTs = pendingCreate
          ? Math.max(
              Number(pendingCreate.ts),
              pendingCreate.deletedAt ? Number(pendingCreate.deletedAt) : 0
            )
          : -1;
        if (incomingActionTs > pendingActionTs) {
          toCreate.set(item.mediaKey, {
            profileId,
            mediaKey: item.mediaKey,
            url: item.url ?? '',
            canonicalId: item.canonicalId ?? '',
            title: item.title ?? '',
            orig: item.orig ?? '',
            poster: item.poster ?? '',
            ts: BigInt(clampedTs),
            deletedAt: clampedDeletedAt !== null ? BigInt(clampedDeletedAt) : null,
            updatedOnServerAt: BigInt(serverNow),
          });
        }
        continue;
      }

      const existingActionTs = Math.max(
        Number(existing.ts),
        existing.deletedAt ? Number(existing.deletedAt) : 0
      );

      if (incomingActionTs <= existingActionTs) {
        continue;
      }

      const updatePayload = {
        url: item.url ?? existing.url,
        canonicalId: item.canonicalId ?? existing.canonicalId,
        title: item.title ?? existing.title,
        orig: item.orig ?? existing.orig,
        poster: item.poster ?? existing.poster,
        ts: BigInt(clampedTs),
        deletedAt: clampedDeletedAt !== null ? BigInt(clampedDeletedAt) : null,
        updatedOnServerAt: BigInt(serverNow),
      };
      existingMap.set(item.mediaKey, { ...existing, ...updatePayload });
      toUpdate.set(existing.id, updatePayload);
    }

    if (toCreate.size > 0) {
      await tx.catcastSyncFavorite.createMany({
        data: Array.from(toCreate.values()),
        skipDuplicates: true,
      });
    }

    if (toUpdate.size > 0) {
      await Promise.all(
        Array.from(toUpdate.entries()).map(([id, data]) =>
          tx.catcastSyncFavorite.update({ where: { id }, data })
        )
      );
    }

    // Trim active favorites to max 500 newest
    const overflow = await tx.catcastSyncFavorite.findMany({
      where: { profileId, deletedAt: null },
      orderBy: [{ ts: 'desc' }, { id: 'desc' }],
      skip: CATCAST_SYNC_CONSTANTS.FAVORITES_LIMIT,
      select: { id: true },
    });

    if (overflow.length > 0) {
      await tx.catcastSyncFavorite.deleteMany({
        where: { id: { in: overflow.map((o: any) => o.id) } },
      });
    }
  }

  async pull(ctx: CatcastSyncContext, sinceRaw?: string, meta?: RequestDeviceMetadata) {
    this.syncDeviceMetadataInBackground(ctx, meta);
    const sinceNum = sinceRaw ? Number(sinceRaw) : 0;
    const since = Number.isFinite(sinceNum) && sinceNum > 0 ? Math.trunc(sinceNum) : 0;

    const [profile, historyRows, favoriteRows] = await Promise.all([
      this.prisma.catcastProfile.findUnique({
        where: { id: ctx.profileId },
      }),
      this.prisma.catcastSyncHistory.findMany({
        where: {
          profileId: ctx.profileId,
          ...(since > 0 ? { updatedOnServerAt: { gt: BigInt(since) } } : {}),
        },
        orderBy: { ts: 'desc' },
      }),
      this.prisma.catcastSyncFavorite.findMany({
        where: {
          profileId: ctx.profileId,
          ...(since > 0 ? { updatedOnServerAt: { gt: BigInt(since) } } : { deletedAt: null }),
        },
        orderBy: { ts: 'desc' },
      }),
    ]);

    if (!profile) {
      throw new NotFoundException('Sync profile not found');
    }

    let maxUpdated = since;
    for (const h of historyRows) {
      const u = Number(h.updatedOnServerAt);
      if (u > maxUpdated) maxUpdated = u;
    }
    for (const f of favoriteRows) {
      const u = Number(f.updatedOnServerAt);
      if (u > maxUpdated) maxUpdated = u;
    }

    const searchUpdatedAt = Number(profile.searchUpdatedAt);
    const includeSearch = since === 0 || searchUpdatedAt > since;

    return {
      serverTs: maxUpdated,
      historyClearedTs: Number(profile.historyClearedTs),
      history: historyRows.map(h => ({
        mediaKey: h.mediaKey,
        url: h.url,
        canonicalId: h.canonicalId,
        title: h.title,
        orig: h.orig,
        poster: h.poster,
        season: h.season,
        episode: h.episode,
        episodeName: h.episodeName,
        currentTime: h.currentTime,
        duration: h.duration,
        completed: h.completed,
        watchedEpisodes: h.watchedEpisodes,
        voice: h.voice,
        ts: Number(h.ts),
      })),
      favorites: favoriteRows.map(f => ({
        mediaKey: f.mediaKey,
        url: f.url,
        canonicalId: f.canonicalId,
        title: f.title,
        orig: f.orig,
        poster: f.poster,
        ts: Number(f.ts),
        deletedAt: f.deletedAt !== null ? Number(f.deletedAt) : null,
      })),
      ...(includeSearch
        ? {
            searchHistory: {
              queries: Array.isArray(profile.searchQueries) ? profile.searchQueries : [],
              updatedAt: searchUpdatedAt,
            },
          }
        : {}),
    };
  }

  async cleanupExpiredData() {
    const now = Date.now();
    const tombstoneCutoff = BigInt(
      now - CATCAST_SYNC_CONSTANTS.TOMBSTONE_RETENTION_DAYS * 24 * 60 * 60 * 1000
    );
    const orphanCutoff = new Date(
      now - CATCAST_SYNC_CONSTANTS.ORPHAN_PROFILE_RETENTION_DAYS * 24 * 60 * 60 * 1000
    );

    const deletedTombstones = await this.prisma.catcastSyncFavorite.deleteMany({
      where: {
        deletedAt: { not: null, lt: tombstoneCutoff },
      },
    });

    const deletedOrphanProfiles = await this.prisma.catcastProfile.deleteMany({
      where: {
        devices: { none: {} },
        updatedAt: { lt: orphanCutoff },
      },
    });

    return {
      deletedTombstones: deletedTombstones.count,
      deletedOrphanProfiles: deletedOrphanProfiles.count,
    };
  }
}
