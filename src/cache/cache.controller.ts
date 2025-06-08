import { Controller, Get } from '@nestjs/common';
import { CacheService } from './cache.service';

@Controller('cache')
export class CacheController {
  constructor(private readonly cacheService: CacheService) {}

  @Get('refresh')
  async refresh() {
    await this.cacheService.refresh();
    return { success: true };
  }
}
