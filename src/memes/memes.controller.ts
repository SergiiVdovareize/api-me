import { Controller, Get, Param, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { MemesService } from './memes.service';
import { OriginGuard } from './origin.guard';

@Controller('memes')
@UseGuards(OriginGuard)
export class MemesController {
  constructor(private readonly memesService: MemesService) {}

  @Get(':url')
  async steal(
    @Param('url') url: string,
    @Query('filename') filename?: string
  ): Promise<StreamableFile> {
    return this.memesService.streamVideo(url, filename);
  }
}
