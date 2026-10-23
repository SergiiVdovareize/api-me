import { Controller, Get, Query, Res, Options, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { ProxyService } from './proxy.service';

@Controller(['proxy', 'api/proxy'])
export class ProxyController {
  constructor(private readonly proxyService: ProxyService) {}

  @Options()
  options(@Res() res: Response) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(HttpStatus.NO_CONTENT).send();
  }

  @Get()
  async proxy(@Query('url') url: string, @Res() res: Response) {
    const result = await this.proxyService.proxyUrl(url);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

    return res.status(result.status).send(result.data);
  }
}
