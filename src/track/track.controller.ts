import { Controller, Get, Param, Query } from '@nestjs/common';
import { TrackService } from './track.service';
import { AnalyticsService } from 'src/analytics/analytics.service';

@Controller('track')
export class TrackController {
  constructor(
    private readonly trackService: TrackService,
    private readonly analyticsService: AnalyticsService
  ) {}

  @Get('')
  async track() {
    console.log('track 0')
    setTimeout(() => {
      console.log('track 10')
    }, 10000);
    setTimeout(() => {
      console.log('track 20')
    }, 20000);
    setTimeout(() => {
      console.log('track 30')
    }, 30000);
    setTimeout(() => {
      console.log('track 40')
    }, 40000);
    setTimeout(() => {
      console.log('track 50')
    }, 50000);
    return {success: true}
  }

  @Get('mono/:id')
  async findOne(@Param('id') id: string, @Query('plain') plain: string) {
    this.analyticsService.trackEvent('BalanceTrack', {type: 'mono', id, plain});
    return await this.trackService.findOne(id, ["true", "1"].includes(plain));
  }

  @Get('watch/:id')
  async watchMono(@Param('id') id: string, @Query('plain') plain: string) {
    return await this.trackService.findOne(id, ["true", "1"].includes(plain));
  }
}
