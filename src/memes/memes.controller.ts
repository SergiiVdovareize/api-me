import { Controller, Get, Param } from '@nestjs/common';
import { RequestsService } from 'src/requests/requests.service';
import { MemesService } from './memes.service';

@Controller('memes')
export class MemesController {
  constructor(
    private readonly memesService: MemesService,
    private readonly requestsService: RequestsService,
  ) {}

  @Get(':url')
  async steal(@Param('url') url: string): Promise<{}> {
    await this.requestsService.registerInstagramMemeApiCall();
    console.log('source url', url);
    const result = await this.memesService.steelFromPubler(url);

    return result;
  }
}
