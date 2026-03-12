import { Controller, Get, Param, Query } from '@nestjs/common';
import { TrackService } from './track.service';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { AccountType } from 'src/models/enums/account-type.enum';
import { AnalyticsEvent } from 'src/analytics/analytics.events';

@Controller('track')
export class TrackController {
  constructor(
    private readonly trackService: TrackService,
    private readonly analyticsService: AnalyticsService
  ) { }

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

  @Get('')
  async track() {
    await this.trackService.syncAccounts();
    return { success: true };
  }

  @Get('ping')
  async ping() {
    const timestamp = this.getTime();
    console.log('ping:', timestamp);
    return { state: 'ping', timestamp };
  }

  @Get('pong')
  async pong() {
    const timestamp = this.getTime();
    console.log('pong:', timestamp);
    return { state: 'pong', timestamp };
  }

  @Get('refresh')
  async refresh() {
    this.analyticsService.trackApiEvent(AnalyticsEvent.Refresh);
    await this.trackService.refreshAccounts();
    return { success: true };
  }

  @Get('deactivate/:trackId')
  async deactivate(@Param('trackId') trackId: string) {
    this.analyticsService.trackEvent(AnalyticsEvent.DeactivateAccount, { trackId });
    await this.trackService.deactivateAccountByTrackId(trackId);
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

    this.analyticsService.trackEvent(AnalyticsEvent.TrackCheck, { type, id, plain });

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
    // this.analyticsService.trackEvent(AnalyticsEvent.BalanceTrack, { type: 'mono', id, plain: isPlain });
    return await this.trackService.checkMono(id, isPlain);
  }

  @Get('watch/:type/:id')
  async watch(
    @Param('type') type: AccountType,
    @Param('id') id: string,
    @Query('force') force: string
  ) {
    const isForce = ['true', '1'].includes(force);
    this.analyticsService.trackEvent(AnalyticsEvent.TrackWatch, { type, id, force: isForce });
    const account = await this.trackService.watch(type, id, isForce);
    return {
      success: true,
      watch: account,
    };
  }
}
