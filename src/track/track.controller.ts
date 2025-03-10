import { Controller, Get, Param, Query } from '@nestjs/common';
import { TrackService } from './track.service';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { AccountType } from 'src/models/enums/account-type.enum';
import { env } from 'process';

@Controller('track')
export class TrackController {
  constructor(
    private readonly trackService: TrackService,
    private readonly analyticsService: AnalyticsService
  ) {}

  @Get('')
  async track(@Query('loop') loop: string = 'false') {
    // console.log('track', loop)
    await this.trackService.syncAccounts();
    // if (!["true", "1"].includes(loop)) {
      const loopHost = env.HOST === 'local' ? 'http://localhost:3000' : 'https://api.vdovareize.me';
      const loopUrl = `${loopHost}/track/2`;

      setTimeout(async () => {
        console.log('fetch 30')
        const resp = await (await fetch(loopUrl)).json();
        console.log(resp)
      }, 30000);
    // }
    return {success: true}
  }

  @Get('/2')
  async track2() {
    await this.trackService.syncAccounts();
    return {success: true, message: 'from track2'}
  }

  @Get('check/:type/:id')
  async check(@Param('type') type: AccountType, @Param('id') id: string, @Query('plain') plain: string) {
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
