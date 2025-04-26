import { Controller, Get, Param } from '@nestjs/common';
import { RequestsService } from 'src/requests/requests.service';
import { MemesService } from './memes.service';

@Controller('memes')
export class MemesController {
  constructor(
    private readonly memesService: MemesService,
    private readonly requestsService: RequestsService
  ) {}

  @Get(':url')
  async steal(@Param('url') url: string): Promise<object> {
    const result = await this.memesService.steelFromPubler(url);
    // const result = await this.memesService.steelFromSquidlr(url);
    // const result = await this.memesService.steelFromGetInDevice(url)
    // const result = await this.memesService.steelFromSnap(url)

    return result;
  }
}
