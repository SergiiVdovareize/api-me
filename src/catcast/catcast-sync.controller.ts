import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { CatcastSyncService } from './catcast-sync.service';
import { CatcastSyncGuard, CatcastSyncRequest } from './catcast-sync.guard';
import {
  InitProfileDto,
  PairAcceptDto,
  PairConfirmDto,
  PairInitDto,
  SyncPushDto,
  UnlinkDeviceQueryDto,
} from './dto/catcast-sync.dto';
import { validateCronSecret } from '../prices/prices.auth';
import { extractRequestDeviceMetadata } from './catcast-device-meta.util';

function extractClientIp(req: Request): string {
  const cfConnectingIp = req.headers['cf-connecting-ip'];
  const forwarded = req.headers['x-forwarded-for'];
  return (
    (typeof cfConnectingIp === 'string' && cfConnectingIp) ||
    (typeof forwarded === 'string' && forwarded.split(',')[0].trim()) ||
    req.socket?.remoteAddress ||
    req.ip ||
    '127.0.0.1'
  );
}

@Controller('catcast/sync')
export class CatcastSyncController {
  constructor(
    private readonly syncService: CatcastSyncService,
    private readonly configService: ConfigService
  ) {}

  @Post('profile/init')
  @HttpCode(HttpStatus.OK)
  async initProfile(@Body() body: InitProfileDto, @Req() req: Request) {
    return this.syncService.initProfile(
      body,
      extractClientIp(req),
      extractRequestDeviceMetadata(req.headers || {})
    );
  }

  @Post('pair/init')
  @UseGuards(CatcastSyncGuard)
  @HttpCode(HttpStatus.OK)
  async pairInit(@Req() req: CatcastSyncRequest, @Body() body: PairInitDto) {
    return this.syncService.pairInit(
      req.catcastSync,
      body,
      extractRequestDeviceMetadata(req.headers || {})
    );
  }

  @Post('pair/confirm')
  @HttpCode(HttpStatus.OK)
  async pairConfirm(@Body() body: PairConfirmDto, @Req() req: Request) {
    return this.syncService.pairConfirm(
      body,
      extractClientIp(req),
      extractRequestDeviceMetadata(req.headers || {})
    );
  }

  @Get('pair/status')
  async pairStatus(
    @Query('code') code: string,
    @Query('pairSecret') pairSecret: string,
    @Req() req: Request,
    @Query('role') role?: string
  ) {
    return this.syncService.pairStatus(code, pairSecret, extractClientIp(req), role);
  }

  @Post('pair/accept')
  @UseGuards(CatcastSyncGuard)
  @HttpCode(HttpStatus.OK)
  async pairAccept(@Req() req: CatcastSyncRequest, @Body() body: PairAcceptDto) {
    return this.syncService.pairAccept(
      req.catcastSync,
      body,
      extractRequestDeviceMetadata(req.headers || {})
    );
  }

  @Get('devices')
  @UseGuards(CatcastSyncGuard)
  async listDevices(@Req() req: CatcastSyncRequest) {
    return this.syncService.listDevices(req.catcastSync);
  }

  @Delete('devices/:deviceId')
  @UseGuards(CatcastSyncGuard)
  async removeDevice(
    @Req() req: CatcastSyncRequest,
    @Param('deviceId') deviceId: string,
    @Query() query: UnlinkDeviceQueryDto
  ) {
    return this.syncService.removeDevice(req.catcastSync, deviceId, query.mode ?? 'unlink');
  }

  @Post('push')
  @UseGuards(CatcastSyncGuard)
  @HttpCode(HttpStatus.OK)
  async push(@Req() req: CatcastSyncRequest, @Body() body: SyncPushDto) {
    return this.syncService.push(
      req.catcastSync,
      body,
      extractRequestDeviceMetadata(req.headers || {})
    );
  }

  @Get('pull')
  @UseGuards(CatcastSyncGuard)
  async pull(@Req() req: CatcastSyncRequest, @Query('since') since?: string) {
    return this.syncService.pull(
      req.catcastSync,
      since,
      extractRequestDeviceMetadata(req.headers || {})
    );
  }

  @Post('cleanup')
  @HttpCode(HttpStatus.OK)
  async cleanup(
    @Headers('x-cron-secret') cronSecretHeader?: string,
    @Headers('x-check-secret') checkSecretHeader?: string,
    @Headers('authorization') authHeader?: string
  ) {
    validateCronSecret(this.configService, cronSecretHeader, checkSecretHeader, authHeader);
    return this.syncService.cleanupExpiredData();
  }
}
