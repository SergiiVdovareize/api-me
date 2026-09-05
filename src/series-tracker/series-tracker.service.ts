import { Injectable, Logger } from '@nestjs/common';
import { GoogleSheetsService } from './services/google-sheets.service';
import { UakinoParserService } from './services/uakino-parser.service';
import { CheckReportItem, SeriesCheckSummary } from './types';

@Injectable()
export class SeriesTrackerService {
  private readonly logger = new Logger(SeriesTrackerService.name);

  constructor(
    private readonly googleSheetsService: GoogleSheetsService,
    private readonly uakinoParserService: UakinoParserService
  ) {}

  /**
   * Executes a full check cycle for all active tracked series:
   * 1. Fetches series list from Google Sheets
   * 2. Checks UAKino for each series
   * 3. Sends Telegram outbox row and updates sheet state if a new 1080p+ episode/season is released
   */
  async checkAllSeries(): Promise<SeriesCheckSummary> {
    const cycleStartTime = Date.now();
    this.logger.log('========== STARTING SERIES RELEASE MONITORING CYCLE ==========');

    const seriesList = await this.googleSheetsService.getTrackedSeries();
    const details: CheckReportItem[] = [];
    let notifiedCount = 0;

    const activeSeries = seriesList.filter(s => s.isActive);
    this.logger.log(
      `Total series in sheet: ${seriesList.length} (${activeSeries.length} active, ${seriesList.length - activeSeries.length} disabled/inactive)`
    );

    let index = 0;
    for (const item of seriesList) {
      index++;

      if (!item.isActive) {
        this.logger.log(
          `[${index}/${seriesList.length}] SKIPPED: "${item.title}" (marked inactive in sheet)`
        );
        details.push({
          id: item.id,
          title: item.title,
          previous: { season: item.lastSeason, episode: item.lastEpisode },
          current: { season: item.lastSeason, episode: item.lastEpisode },
          status: 'skipped',
        });
        continue;
      }

      this.logger.log(
        `[${index}/${seriesList.length}] CHECKING: [${item.id}] "${item.title}" | Sheet progress: Season ${item.lastSeason}, Episode ${item.lastEpisode}`
      );

      const itemStartTime = Date.now();

      try {
        const result = await this.uakinoParserService.checkSeries(item.season1Url, item.title);

        const hasNewSeason = result.latestSeason > item.lastSeason;
        const hasNewEpisode =
          result.latestSeason === item.lastSeason && result.latestEpisode > item.lastEpisode;

        const isNewRelease = (hasNewSeason || hasNewEpisode) && result.hasConfirmedRelease;

        this.logger.log(
          `Comparison for "${item.title}": [Sheet: S${item.lastSeason}E${item.lastEpisode}] vs [UAKino 1080p+: S${result.latestSeason}E${result.latestEpisode}] -> New Season? ${hasNewSeason}, New Episode? ${hasNewEpisode}, Confirmed 1080p+? ${result.hasConfirmedRelease}`
        );

        if (isNewRelease) {
          this.logger.log(
            `🚀 >>> ACTION REQUIRED: New release detected for "${item.title}": S${result.latestSeason}E${result.latestEpisode} (was S${item.lastSeason}E${item.lastEpisode})`
          );

          // 1. Append message to Telegram Outbox
          await this.googleSheetsService.appendTelegramOutbox(
            item.title,
            result.latestSeason,
            result.latestEpisode,
            result.posterUrl,
            item.id
          );

          // 2. Update state in Google Sheets Series tab
          await this.googleSheetsService.updateSeriesState(
            item.rowIndex,
            result.latestSeason,
            result.latestEpisode
          );

          notifiedCount++;
          details.push({
            id: item.id,
            title: item.title,
            previous: { season: item.lastSeason, episode: item.lastEpisode },
            current: { season: result.latestSeason, episode: result.latestEpisode },
            status: 'notified',
            url: result.latestUrl,
          });
        } else {
          this.logger.log(
            `✅ UP-TO-DATE: "${item.title}" remains at S${item.lastSeason}E${item.lastEpisode} (Checked in ${Date.now() - itemStartTime}ms)`
          );

          // Update Last Checked timestamp in column H
          await this.googleSheetsService.updateLastChecked(item.rowIndex);

          details.push({
            id: item.id,
            title: item.title,
            previous: { season: item.lastSeason, episode: item.lastEpisode },
            current: { season: result.latestSeason, episode: result.latestEpisode },
            status: 'up-to-date',
            url: result.latestUrl,
          });
        }
      } catch (error) {
        this.logger.error(
          `❌ ERROR checking "${item.title}" (${item.season1Url}): ${error.message}`,
          error.stack
        );
        details.push({
          id: item.id,
          title: item.title,
          previous: { season: item.lastSeason, episode: item.lastEpisode },
          current: { season: item.lastSeason, episode: item.lastEpisode },
          status: 'error',
          error: error.message,
        });
      }
    }

    const totalDuration = Date.now() - cycleStartTime;
    const summary: SeriesCheckSummary = {
      checkedCount: seriesList.length,
      notifiedCount,
      timestamp: new Date().toISOString(),
      details,
    };

    this.logger.log(
      `========== MONITORING CYCLE COMPLETED in ${totalDuration}ms. Checked: ${summary.checkedCount}, Notified: ${summary.notifiedCount} ==========`
    );

    return summary;
  }
}
