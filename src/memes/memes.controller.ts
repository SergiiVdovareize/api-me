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
    // const startTime = Date.now()
    const result = await this.memesService.steelFromPubler(url);
    // const data = {
    //   executionTime: Date.now() - startTime,
    //   succ: !!result.success,
    //   tool: 'publer'
    // }
    // console.log('data', data)
    // console.log('result', result)
    // await this.requestsService.registerMemeApiCall(url, data);

    return result;
  }
}
