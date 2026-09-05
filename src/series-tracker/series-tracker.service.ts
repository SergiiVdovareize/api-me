import { Injectable, Logger } from '@nestjs/common';
import { GoogleSheetsService } from './services/google-sheets.service';
import { UakinoParserService } from './services/uakino-parser.service';
import { CheckReportItem, SeriesCheckOptions, SeriesCheckSummary, TrackedSeriesItem } from './types';

@Injectable()
export class SeriesTrackerService {
  private readonly logger = new Logger(SeriesTrackerService.name);

  constructor(
    private readonly googleSheetsService: GoogleSheetsService,
    private readonly uakinoParserService: UakinoParserService
  ) {}

  /**
   * Executes series release checks.
   * Defaults to incremental / round-robin mode (1 series per trigger with the oldest lastChecked)
   * so every invocation finishes in 2-4 seconds, staying well within Vercel serverless 10-second limits.
   */
  async checkSeriesReleases(options?: SeriesCheckOptions): Promise<SeriesCheckSummary> {
    const cycleStartTime = Date.now();
    this.logger.log('========== STARTING SERIES RELEASE MONITORING CYCLE ==========');

    const seriesList = await this.googleSheetsService.getTrackedSeries();
    const activeSeries = seriesList.filter(s => s.isActive);
    const details: CheckReportItem[] = [];
    let notifiedCount = 0;

    this.logger.log(
      `Total series in sheet: ${seriesList.length} (${activeSeries.length} active, ${seriesList.length - activeSeries.length} disabled/inactive)`
    );

    if (seriesList.length === 0) {
      this.logger.log('No series found in sheet.');
      return {
        checkedCount: 0,
        totalActiveCount: 0,
        notifiedCount: 0,
        timestamp: new Date().toISOString(),
        details: [],
      };
    }

    let targetSeries: TrackedSeriesItem[] = [];
    let nextSeriesId: string | undefined;

    if (options?.seriesId) {
      const match = seriesList.find(
        s => s.id.toLowerCase() === options.seriesId?.trim().toLowerCase()
      );
      if (!match) {
        this.logger.warn(`No series found matching ID "${options.seriesId}".`);
        return {
          checkedCount: 0,
          totalActiveCount: activeSeries.length,
          notifiedCount: 0,
          timestamp: new Date().toISOString(),
          details: [],
        };
      }
      targetSeries = [match];
    } else if (options?.checkAll) {
      targetSeries = seriesList;
    } else {
      if (activeSeries.length === 0) {
        this.logger.log('No active series found in sheet.');
        return {
          checkedCount: 0,
          totalActiveCount: 0,
          notifiedCount: 0,
          timestamp: new Date().toISOString(),
          details: [],
        };
      }

      // Incremental / Round-robin: sort active series by lastChecked ascending.
      // Older or missing timestamps get checked first.
      const sorted = [...activeSeries].sort((a, b) => {
        const timeA = a.lastChecked ? Date.parse(a.lastChecked.replace(/-/g, '/')) || 0 : 0;
        const timeB = b.lastChecked ? Date.parse(b.lastChecked.replace(/-/g, '/')) || 0 : 0;
        return timeA - timeB;
      });

      const limit = options?.limit && options.limit > 0 ? options.limit : 1;
      targetSeries = sorted.slice(0, limit);

      if (sorted.length > limit) {
        nextSeriesId = sorted[limit].id;
      } else if (sorted.length > 0) {
        nextSeriesId = sorted[0].id;
      }
    }

    this.logger.log(
      `Selected ${targetSeries.length} series for check (mode: ${options?.seriesId ? `single [${options.seriesId}]` : options?.checkAll ? 'all' : `incremental limit=${targetSeries.length}`})`
    );

    let index = 0;
    for (const item of targetSeries) {
      index++;

      if (!item.isActive) {
        this.logger.log(
          `[${index}/${targetSeries.length}] SKIPPED: "${item.title}" (marked inactive in sheet)`
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
        `[${index}/${targetSeries.length}] CHECKING: [${item.id}] "${item.title}" | Sheet progress: Season ${item.lastSeason}, Episode ${item.lastEpisode}`
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
      checkedCount: targetSeries.length,
      totalActiveCount: activeSeries.length,
      notifiedCount,
      timestamp: new Date().toISOString(),
      nextSeriesId,
      details,
    };

    this.logger.log(
      `========== MONITORING CYCLE COMPLETED in ${totalDuration}ms. Checked: ${summary.checkedCount}, Notified: ${summary.notifiedCount} ==========`
    );

    return summary;
  }

  async checkAllSeries(): Promise<SeriesCheckSummary> {
    return this.checkSeriesReleases({ checkAll: true });
  }
}
