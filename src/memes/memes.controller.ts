import { Controller, Get, Param, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { MemesService } from './memes.service';
import { OriginGuard } from './origin.guard';

@Controller('memes')
@UseGuards(OriginGuard)
export class MemesController {
  constructor(private readonly memesService: MemesService) {}

  @Get('download/next')
  async downloadNext(
    @Query('url') url: string,
    @Query('type') type: string,
    @Query('quality') quality: string,
    @Query('ext') ext: string,
    @Query('title') title: string,
    @Query('duration') duration: string
  ): Promise<StreamableFile> {
    return this.memesService.downloadFromNextdownloader({
      url,
      type,
      quality,
      ext,
      title,
      duration,
    });
  }

  @Get(':url')
  async steal(@Param('url') url: string): Promise<object> {
    const result = await this.memesService.stealMeme(url);
    return result;
  }
}
