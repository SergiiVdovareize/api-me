import {
  Controller,
  Post,
  Get,
  Options,
  Body,
  Query,
  Req,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { CatcastService, VerifyAccessDto, CreateDeviceRequestDto } from './catcast.service';
import { applyCatcastCorsHeaders } from './catcast.constants';

@Controller('auth/catcast')
export class CatcastController {
  constructor(private readonly catcastService: CatcastService) {}

  @Options('verify')
  handleOptionsVerify(@Res() res: Response): void {
    applyCatcastCorsHeaders(res);
    res.status(HttpStatus.OK).end();
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verify(
    @Body() body: VerifyAccessDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    applyCatcastCorsHeaders(res);

    // Extract client IP (handling reverse proxies like Cloudflare or Vercel)
    const forwarded = req.headers['x-forwarded-for'];
    const cfConnectingIp = req.headers['cf-connecting-ip'];
    const rawIp =
      (typeof cfConnectingIp === 'string' && cfConnectingIp) ||
      (typeof forwarded === 'string' && forwarded) ||
      req.socket?.remoteAddress ||
      req.ip ||
      '127.0.0.1';

    const result = await this.catcastService.verifyAccess(body, rawIp);
    return result;
  }

  @Options('request')
  handleOptionsRequest(@Res() res: Response): void {
    applyCatcastCorsHeaders(res);
    res.status(HttpStatus.OK).end();
  }

  @Post('request')
  @HttpCode(HttpStatus.OK)
  async createRequest(
    @Body() body: CreateDeviceRequestDto,
    @Res({ passthrough: true }) res: Response
  ) {
    applyCatcastCorsHeaders(res);
    return this.catcastService.requestDeviceAccess(body);
  }

  @Options('status')
  handleOptionsStatus(@Res() res: Response): void {
    applyCatcastCorsHeaders(res);
    res.status(HttpStatus.OK).end();
  }

  @Get('status')
  async getStatus(@Query('deviceId') deviceId: string, @Res({ passthrough: true }) res: Response) {
    applyCatcastCorsHeaders(res);
    return this.catcastService.getDeviceStatus(deviceId);
  }
}
