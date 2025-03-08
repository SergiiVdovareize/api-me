import { Controller, Get, Param, Query } from '@nestjs/common';
import { TrackService } from './track.service';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { AccountType } from 'src/models/enums/account-type.enum';

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

  @Get('check/:type/:id')
  async check(@Param('type') type: AccountType, @Param('id') id: string, @Query('plain') plain: string) {
    this.analyticsService.trackEvent('BalanceTrack', { type, id, plain });
    if (!Object.values(AccountType).includes(type as AccountType)) {
      return {
        success: false,
        message: `Invalid type: ${type}`
      }
    }

    switch (type) {
      case AccountType.MONO:
        return await this.trackService.checkMono(id, ["true", "1"].includes(plain));
      case AccountType.PRIVAT:
        return {
          success: false,
          message: `Type is not yet supported: ${type}`
        }
    }
  }

  @Get('mono/:id')
  async findOne(@Param('id') id: string, @Query('plain') plain: string) {
    this.analyticsService.trackEvent('BalanceTrack', {type: 'mono', id, plain});
    return await this.trackService.checkMono(id, ["true", "1"].includes(plain));
  }

  @Get('watch/:type/:id')
  async watch(@Param('type') type: AccountType, @Param('id') id: string) {
    const account = await this.trackService.watch(type, id);
    return {
      success: true,
      watch: account,
    }
  }
}
