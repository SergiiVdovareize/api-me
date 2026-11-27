import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Request } from 'express';
import { PrismaService } from '../models/prisma/prisma.service';
import { CATCAST_SYNC_CONSTANTS } from './catcast-sync.constants';

export interface CatcastSyncContext {
  profileId: string;
  deviceId: string;
  platform: string;
  model: string | null;
  os: string | null;
  browser: string | null;
  deviceName: string | null;
  city: string | null;
  country: string | null;
}

export interface CatcastSyncRequest extends Request {
  catcastSync: CatcastSyncContext;
}

export function hashSyncToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class CatcastSyncGuard implements CanActivate {
  private readonly logger = new Logger(CatcastSyncGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<CatcastSyncRequest>();
    const authHeader = req.headers['authorization'];
    const token =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : '';

    if (!token) {
      throw new UnauthorizedException({
        error: CATCAST_SYNC_CONSTANTS.ERROR_CODES.INVALID_SYNC_TOKEN,
        message: 'Missing Bearer sync token',
      });
    }

    const tokenHash = hashSyncToken(token);
    const device = await this.prisma.catcastDevice.findUnique({
      where: { syncTokenHash: tokenHash },
    });

    if (!device || !device.profileId) {
      throw new UnauthorizedException({
        error: CATCAST_SYNC_CONSTANTS.ERROR_CODES.INVALID_SYNC_TOKEN,
        message: 'Invalid or revoked sync token',
      });
    }

    if (!device.isAllowed) {
      throw new UnauthorizedException({
        error: CATCAST_SYNC_CONSTANTS.ERROR_CODES.DEVICE_NOT_ALLOWED,
        message: 'Device access is not allowed',
      });
    }

    req.catcastSync = {
      profileId: device.profileId,
      deviceId: device.deviceId,
      platform: device.platform,
      model: device.model,
      os: device.os,
      browser: device.browser,
      deviceName: device.deviceName,
      city: device.city ?? null,
      country: device.country ?? null,
    };

    // Throttled update of syncLastSeenAt (non-blocking for request latency)
    const now = Date.now();
    const lastSeenMs = device.syncLastSeenAt ? device.syncLastSeenAt.getTime() : 0;
    if (now - lastSeenMs > CATCAST_SYNC_CONSTANTS.LAST_SEEN_UPDATE_INTERVAL_MS) {
      this.prisma.catcastDevice
        .update({
          where: { id: device.id },
          data: { syncLastSeenAt: new Date(now) },
        })
        .catch(err => {
          this.logger.warn(
            `Failed to update syncLastSeenAt for ${device.deviceId}: ${err.message}`
          );
        });
    }

    return true;
  }
}
