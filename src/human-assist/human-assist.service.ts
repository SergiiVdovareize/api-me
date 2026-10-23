import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../models/prisma/prisma.service';
import { SyncPayloadDto } from './dto/sync-payload.dto';
import { SyncGetResponse, SyncPostResponse } from './interfaces/human-assist.interface';

@Injectable()
export class HumanAssistService {
  private readonly logger = new Logger(HumanAssistService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getSyncData(userId: string): Promise<SyncGetResponse> {
    if (!userId || userId.trim() === '') {
      throw new BadRequestException({ error: 'Invalid parameter: userId is required' });
    }

    const record = await this.prisma.humanAssistSync.findUnique({
      where: { userId: userId.trim() },
    });

    if (!record) {
      return {
        userId: userId.trim(),
        data: {},
        updatedAt: null,
      };
    }

    return {
      userId: record.userId,
      data: record.data as Record<string, any>,
      updatedAt: record.updatedAt.getTime(),
    };
  }

  async saveSyncData(userId: string, payload: SyncPayloadDto): Promise<SyncPostResponse> {
    if (!userId || userId.trim() === '') {
      throw new BadRequestException({ error: 'Invalid parameter: userId is required' });
    }

    if (!payload || !payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
      throw new BadRequestException({ error: 'Invalid payload: data object is required' });
    }

    const now = new Date();
    const result = await this.prisma.humanAssistSync.upsert({
      where: { userId: userId.trim() },
      create: {
        userId: userId.trim(),
        data: payload.data,
        updatedAt: now,
      },
      update: {
        data: payload.data,
        updatedAt: now,
      },
    });

    return {
      success: true,
      updatedAt: result.updatedAt.getTime(),
    };
  }
}
