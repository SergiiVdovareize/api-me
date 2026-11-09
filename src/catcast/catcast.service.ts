import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
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
  deviceId: string;
  boundDeviceId: string;
  platform: string;
}

@Injectable()
export class CatcastService {
  private readonly logger = new Logger(CatcastService.name);
  private deviceRequestNotifier?: (
    request: any
  ) => Promise<{ messageId?: number; chatId?: string } | void>;

  constructor(
    @Optional() private readonly configService?: ConfigService,
    @Optional() private readonly redisReader?: RedisReader,
    @Optional() private readonly prisma?: PrismaService
  ) {}

  /**
   * Registers a notifier function (e.g. from TelegramService) called when a new device request arrives.
   */
  setDeviceRequestNotifier(
    notifier: (request: any) => Promise<{ messageId?: number; chatId?: string } | void>
  ): void {
    this.deviceRequestNotifier = notifier;
  }

  /**
   * Verifies access strictly by deviceId against the CatcastDevice allowlist table.
   */
  async verifyAccess(
    dto: VerifyAccessDto | undefined,
    _clientIp?: string
  ): Promise<VerifyAccessResult> {
    const deviceId = dto?.deviceId;
    if (!deviceId || typeof deviceId !== 'string' || deviceId.trim() === '') {
      throw new BadRequestException({
        success: false,
        error: CATCAST_CONSTANTS.ERROR_CODES.DEVICE_ID_REQUIRED,
        message: CATCAST_CONSTANTS.ERROR_MESSAGES.DEVICE_ID_REQUIRED,
      });
    }

    const cleanDeviceId = deviceId.trim();
    const platform = (dto?.platform || 'web').trim();

    if (!this.prisma) {
      throw new Error('Database service unavailable');
    }

    const device = await this.prisma.catcastDevice.findUnique({
      where: { deviceId: cleanDeviceId },
    });

    if (!device || !device.isAllowed) {
      this.logger.warn(`Rejected unauthorized CatCast device: "${cleanDeviceId}"`);
      throw new UnauthorizedException({
        success: false,
        error: CATCAST_CONSTANTS.ERROR_CODES.DEVICE_NOT_ALLOWED,
        message: CATCAST_CONSTANTS.ERROR_MESSAGES.DEVICE_NOT_ALLOWED,
      });
    }

    return {
      success: true,
      deviceId: cleanDeviceId,
      boundDeviceId: cleanDeviceId,
      platform: device.platform || platform,
    };
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
