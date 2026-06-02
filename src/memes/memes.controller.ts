import { Controller, Get, Param } from '@nestjs/common';
import { MemesService } from './memes.service';

@Controller('memes')
export class MemesController {
  constructor(private readonly memesService: MemesService) {}

  @Get(':url')
  async steal(@Param('url') url: string): Promise<object> {
    const result = await this.memesService.stealMeme(url);
    return result;
  }
}
