import { Controller, Get, Post, Query, Headers, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SeriesTrackerService } from './series-tracker.service';
import { GoogleSheetsService } from './services/google-sheets.service';
import { SeriesCheckSummary, TrackedSeriesItem } from './types';

@Controller('series-tracker')
export class SeriesTrackerController {
  private readonly logger = new Logger(SeriesTrackerController.name);

  constructor(
    private readonly seriesTrackerService: SeriesTrackerService,
    private readonly googleSheetsService: GoogleSheetsService,
    private readonly configService: ConfigService
  ) {}

  private validateToken(token?: string, authHeader?: string): void {
    const expectedSecret =
      this.configService.get<string>('CRON_SECRET') ||
      this.configService.get<string>('SERIES_TRACKER_SECRET');

    if (!expectedSecret) {
      // If no secret is configured, allow the request
      return;
    }

    const bearerToken = authHeader?.startsWith('Bearer ')
      ? authHeader.substring(7)
      : undefined;

    const providedToken = token || bearerToken;

    if (providedToken !== expectedSecret) {
      this.logger.warn('Unauthorized trigger attempt: token mismatch or missing token');
      throw new UnauthorizedException('Invalid or missing security token');
    }
  }

  /**
   * Main entry point to trigger release check via GET.
   */
  @Get('check')
  async checkViaGet(
    @Query('token') token?: string,
    @Headers('authorization') authHeader?: string
  ): Promise<SeriesCheckSummary> {
    this.logger.log('Incoming GET /series-tracker/check trigger');
    this.validateToken(token, authHeader);
    return await this.seriesTrackerService.checkAllSeries();
  }

  /**
   * Main entry point to trigger release check via POST.
   */
  @Post('check')
  async checkViaPost(
    @Query('token') token?: string,
    @Headers('authorization') authHeader?: string
  ): Promise<SeriesCheckSummary> {
    this.logger.log('Incoming POST /series-tracker/check trigger');
    this.validateToken(token, authHeader);
    return await this.seriesTrackerService.checkAllSeries();
  }

  /**
   * Utility endpoint to inspect the current tracked series list from Google Sheets
   */
  @Get('list')
  async listTracked(
    @Query('token') token?: string,
    @Headers('authorization') authHeader?: string
  ): Promise<any> {
    this.logger.log('Incoming GET /series-tracker/list request');
    this.validateToken(token, authHeader);
    try {
      const allSeries = await this.googleSheetsService.getTrackedSeries();
      return allSeries;
    } catch (error) {
      this.logger.error(`Error in listTracked: ${error.message}`, error.stack);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
