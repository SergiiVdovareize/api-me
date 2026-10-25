import { Controller, Get, Post, Options, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { ProxyService } from './proxy.service';
import { PROXY_CONFIG, applyProxyCorsHeaders } from './proxy.constants';

@Controller(PROXY_CONFIG.ROUTES as unknown as string[])
export class ProxyController {
  constructor(private readonly proxyService: ProxyService) {}

  @Options()
  handleOptions(@Res() res: Response): void {
    applyProxyCorsHeaders(res);
    res.status(200).end();
  }

  @Get()
  async getProxy(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.proxyService.handleProxy(req, res);
  }

  @Post()
  async postProxy(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.proxyService.handleProxy(req, res);
  }
}
