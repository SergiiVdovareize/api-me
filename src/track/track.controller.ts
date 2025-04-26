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

  getTime() {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const seconds = now.getSeconds().toString().padStart(2, '0');

    return `${hours}:${minutes}:${seconds}`;
  }

  async delay() {
    return new Promise<void>(resolve => {
      setTimeout(() => {
        resolve();
      }, 30000);
    });
  }

  // @Get('')
  // async track(@Query('loop') loop: number = 0) {
  //   // console.log('track start loop', loop)
  //   // this.analyticsService.trackEvent('Track', {type: AccountType.MONO});
  //   await this.trackService.syncAccounts();
  //   // console.log('track finish loop', loop)
  //   return { success: true };
  // }

  @Get('/2')
  async track2() {
    new Promise(async (resolve, reject) => {
      const timeout = setTimeout(async () => {
        console.log('track2 timeout', this.getTime());
        try {
          const loopHost =
            env.HOST === 'local' ? 'http://localhost:3000' : 'https://api.vdovareize.me';
          const data = await fetch(loopHost + '/track?loop=1');
          const json = await data.json();
          clearTimeout(timeout);
          console.log('track2 result', json);
          resolve(json);
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      }, 30000);
    });
    return { success: true };
  }

  @Get('refresh')
  async refresh() {
    this.analyticsService.trackEvent('Refresh');
    await this.trackService.refreshAccounts();
    return { success: true };
  }

  @Get('check/:type/:id')
  async check(
    @Param('type') type: AccountType,
    @Param('id') id: string,
    @Query('plain') plain: string
  ) {
    if (!Object.values(AccountType).includes(type as AccountType)) {
      return {
        success: false,
        message: `Invalid type: ${type}`,
      };
    }

    this.analyticsService.trackEvent('TrackCheck', { type, id, plain });

    switch (type) {
      case AccountType.MONO:
        return await this.trackService.checkMono(id, ['true', '1'].includes(plain));
      case AccountType.PRIVAT:
        // await this.trackService.checkPrivat(id);
        return {
          success: false,
          message: `Type is not yet supported: ${type}`,
        };
    }
  }

  @Get('mono/:id')
  async findOne(@Param('id') id: string, @Query('plain') plain: string) {
    const isPlain = ['true', '1'].includes(plain);
    this.analyticsService.trackEvent('BalanceTrack', { type: 'mono', id, plain: isPlain });
    return await this.trackService.checkMono(id, isPlain);
  }

  @Get('watch/:type/:id')
  async watch(
    @Param('type') type: AccountType,
    @Param('id') id: string,
    @Query('force') force: string
  ) {
    const isForce = ['true', '1'].includes(force);
    this.analyticsService.trackEvent('TrackWatch', { type, id, force: isForce });
    const account = await this.trackService.watch(type, id, isForce);
    return {
      success: true,
      watch: account,
    };
  }
}
