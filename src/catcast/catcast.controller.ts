import { Controller, Post, Options, Body, Req, Res, HttpCode, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { CatcastService } from './catcast.service';
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
    @Body() body: { key?: string },
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

    const result = await this.catcastService.verifyAccess(body?.key, rawIp);
    return result;
  }
}
