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
    @Query('filename') filename?: string,
    @Query('retry') retry?: string
  ): Promise<StreamableFile> {
    const parsedRetry = retry !== undefined ? Number(retry) : 0;
    const retryCount =
      Number.isFinite(parsedRetry) && parsedRetry > 0 ? Math.floor(parsedRetry) : 0;
    return this.memesService.streamVideo(url, filename, retryCount);
  }
}
