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

  getTime () {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, "0");
    const minutes = now.getMinutes().toString().padStart(2, "0");
    const seconds = now.getSeconds().toString().padStart(2, "0");
    
    return `${hours}:${minutes}:${seconds}`;
  }

  async delay() {
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve()
      }, 30000);
    })
  }

  @Get('')
  async track(@Query('loop') loop: number = 0) {
    console.log('track loop', loop)
    await this.trackService.syncAccounts();
    return {success: true}
  }

  @Get('/2')
  async track2() {
    console.log('track2 start', this.getTime())
    
    new Promise(async (resolve, reject) => {
      const timeout = setTimeout(async () => {
        console.log('track2 timeout', this.getTime())
        try {
          const loopHost = env.HOST === 'local' ? 'http://localhost:3000' : 'https://api.vdovareize.me';
          const data = await fetch(loopHost + '/track?loop=1');
          const json = await data.json();
          clearTimeout(timeout);
          console.log('track2 result', json)
          resolve(json);
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      }, 10000);
    });
    console.log('track2 finish', this.getTime())
    // console.log(json)
    return {success: true};
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
        // await this.trackService.checkPrivat(id);
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
