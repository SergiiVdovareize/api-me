import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, sheets_v4 } from 'googleapis';
import { TrackedSeriesItem } from '../types';

@Injectable()
export class GoogleSheetsService {
  private readonly logger = new Logger(GoogleSheetsService.name);
  private sheets: sheets_v4.Sheets | null = null;

  // Default IDs for the two separate spreadsheets
  private readonly defaultSeriesSpreadsheetId = '1TXXFR1MpAsUqcmOVRwf-2lZTPpYE3CVzCCmYuilbOLU';
  private readonly defaultOutboxSpreadsheetId = '1zbsVKCvuaFgN4cbn9KNeRKSq3EOT5tsMq2yp6Mpd9dI';

  private cachedOutboxSheetName: string | null = null;
  private resolvedSeriesTabName = 'Series';

  constructor(private readonly configService: ConfigService) {}

  /**
   * Spreadsheet holding the tracked series list
   */
  private getSeriesSpreadsheetId(): string {
    const id =
      this.configService.get<string>('SERIES_SPREADSHEET_ID') ||
      this.defaultSeriesSpreadsheetId;
    return id.trim();
  }

  /**
   * Spreadsheet holding the Telegram Outbox queue
   */
  private getOutboxSpreadsheetId(): string {
    const id =
      this.configService.get<string>('TELEGRAM_OUTBOX_SPREADSHEET_ID') ||
      this.defaultOutboxSpreadsheetId;
    return id.trim();
  }

  private getSheetsClient(): sheets_v4.Sheets {
    if (this.sheets) {
      return this.sheets;
    }

    const clientEmail = this.configService.get<string>('GOOGLE_SERVICE_ACCOUNT_EMAIL')?.trim();
    let privateKey = this.configService.get<string>('GOOGLE_PRIVATE_KEY');

    this.logger.debug(
      `Initializing Google Sheets client. Service Account Email: ${clientEmail ? clientEmail : 'MISSING'}, Private Key: ${privateKey ? 'PRESENT' : 'MISSING'}`
    );

    if (!clientEmail || !privateKey) {
      throw new Error(
        'Google Service Account credentials missing. Please set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in your environment.'
      );
    }

    // Fix escaped newlines if passed in .env
    privateKey = privateKey.replace(/\\n/g, '\n');

    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    this.sheets = google.sheets({ version: 'v4', auth });
    this.logger.log(`Google Sheets API client successfully initialized for ${clientEmail}`);
    return this.sheets;
  }

  /**
   * Identifies the outbox sheet name dynamically in the outbox spreadsheet (matches 'queue' or 'outbox')
   */
  private async resolveOutboxSheetName(): Promise<string> {
    if (this.cachedOutboxSheetName) {
      return this.cachedOutboxSheetName;
    }

    const sheets = this.getSheetsClient();
    const spreadsheetId = this.getOutboxSpreadsheetId();

    this.logger.debug(`Resolving Outbox sheet tab in spreadsheet ${spreadsheetId}...`);

    try {
      const meta = await sheets.spreadsheets.get({ spreadsheetId });
      const sheetTitles = (meta.data.sheets || [])
        .map(s => s.properties?.title)
        .filter((t): t is string => Boolean(t));

      this.logger.debug(`Found tabs in Outbox spreadsheet: [${sheetTitles.join(', ')}]`);

      const matched = sheetTitles.find(t =>
        /telegram.*outbox|outbox|queue/i.test(t)
      );

      if (matched) {
        this.cachedOutboxSheetName = matched;
        this.logger.log(`Resolved Outbox sheet tab: "${matched}"`);
        return matched;
      }

      this.cachedOutboxSheetName = sheetTitles[0] || 'queue';
      this.logger.log(`Using default Outbox tab name: "${this.cachedOutboxSheetName}"`);
      return this.cachedOutboxSheetName;
    } catch (error) {
      this.logger.warn(`Could not fetch Outbox metadata: ${error.message}. Defaulting to 'queue'`);
      return 'queue';
    }
  }

  /**
   * Reads all tracked series from the series spreadsheet
   * Columns: A: ID, B: Title, C: Download URL, D: Target Season, E: Last Known Episode, F: Min Quality, G: Status, H: Last Checked
   */
  async getTrackedSeries(): Promise<TrackedSeriesItem[]> {
    const sheets = this.getSheetsClient();
    const spreadsheetId = this.getSeriesSpreadsheetId();

    try {
      const meta = await sheets.spreadsheets.get({ spreadsheetId });
      const sheetTitles = (meta.data.sheets || [])
        .map(s => s.properties?.title)
        .filter((t): t is string => Boolean(t));

      let targetTab = sheetTitles.find(t => t.trim().toLowerCase() === 'series') || sheetTitles[0];
      this.resolvedSeriesTabName = targetTab;

      this.logger.log(
        `Reading tracked series list from "${spreadsheetId}", tab "${targetTab}", range A2:H...`
      );

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${targetTab}!A2:H`,
      });

      const rows = response.data.values || [];
      if (rows.length === 0) {
        this.logger.warn(`No data rows found in tab "${targetTab}" (A2:H is empty).`);
        return [];
      }

      this.logger.debug(`Received ${rows.length} raw row(s) from "${targetTab}".`);

      const seriesList: TrackedSeriesItem[] = [];

      rows.forEach((row, index) => {
        const id = row[0] ? String(row[0]).trim() : '';
        const title = row[1] ? String(row[1]).trim() : '';
        const season1Url = row[2] ? String(row[2]).trim() : '';

        // Skip rows without URL or title
        if (!season1Url || !title) {
          this.logger.debug(`Row ${index + 2}: skipped (missing title or season1Url).`);
          return;
        }

        const lastSeason = parseInt(String(row[3]), 10) || 1;
        const lastEpisode = parseInt(String(row[4]), 10) || 0;
        const minQuality = row[5] ? String(row[5]).trim() : '1080p';
        const statusRaw = row[6] ? String(row[6]).trim() : 'Active';
        const isActive =
          statusRaw.toLowerCase() === 'active' ||
          ['true', 'yes', '1', '+'].includes(statusRaw.toLowerCase());
        const lastChecked = row[7] ? String(row[7]).trim() : undefined;

        const item: TrackedSeriesItem = {
          rowIndex: index + 2, // 1-indexed, starting from row 2
          id: id || title.toLowerCase().replace(/\s+/g, '-'),
          title,
          season1Url,
          lastSeason,
          lastEpisode,
          minQuality,
          isActive,
          lastChecked,
        };

        this.logger.debug(
          `Row ${item.rowIndex}: [${item.id}] "${item.title}" | Target Season: ${item.lastSeason}, Episode: ${item.lastEpisode} | Status: ${statusRaw} (Active: ${item.isActive})`
        );

        seriesList.push(item);
      });

      this.logger.log(
        `Parsed ${seriesList.length} valid series from Google Sheets (${seriesList.filter(s => s.isActive).length} active).`
      );

      return seriesList;
    } catch (error) {
      this.logger.error(`Failed to fetch tracked series from Google Sheets: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Updates state (Target Season in D, Last Known Episode in E, Last Checked in H) in the series spreadsheet
   */
  async updateSeriesState(
    rowIndex: number,
    lastSeason: number,
    lastEpisode: number,
    _latestUrl?: string
  ): Promise<void> {
    const sheets = this.getSheetsClient();
    const spreadsheetId = this.getSeriesSpreadsheetId();
    const lastChecked = this.formatGmt3Minutes(new Date());

    this.logger.log(
      `Updating Series row ${rowIndex}: Target Season (D) = ${lastSeason}, Last Known Episode (E) = ${lastEpisode}, Last Checked (H) = ${lastChecked}`
    );

    try {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: [
            {
              range: `${this.resolvedSeriesTabName}!D${rowIndex}:E${rowIndex}`,
              values: [[lastSeason, lastEpisode]],
            },
            {
              range: `${this.resolvedSeriesTabName}!H${rowIndex}`,
              values: [[lastChecked]],
            },
          ],
        },
      });
      this.logger.log(`Successfully updated Series row ${rowIndex}.`);
    } catch (error) {
      this.logger.error(`Failed to update Series row ${rowIndex}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Updates only the 'Last Checked' column (H) when a series check finishes without changes
   */
  async updateLastChecked(rowIndex: number): Promise<void> {
    const sheets = this.getSheetsClient();
    const spreadsheetId = this.getSeriesSpreadsheetId();
    const lastChecked = this.formatGmt3Minutes(new Date());

    try {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${this.resolvedSeriesTabName}!H${rowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[lastChecked]],
        },
      });
    } catch (error) {
      this.logger.warn(`Could not update Last Checked for row ${rowIndex}: ${error.message}`);
    }
  }

  /**
   * Builds the Toloka tracker search URL for a given series title
   */
  buildTolokaSearchUrl(englishName: string): string {
    const prefix =
      'https://toloka.to/tracker.php?prev_sd=0&prev_a=0&prev_my=0&prev_n=0&prev_shc=0&prev_shf=1&prev_sha=1&prev_cg=0&prev_ct=0&prev_at=0&prev_nt=0&prev_de=0&prev_nd=0&prev_tcs=1&prev_shs=0&f%5B%5D=117&f%5B%5D=84&f%5B%5D=42&f%5B%5D=124&f%5B%5D=125&f%5B%5D=129&f%5B%5D=219&f%5B%5D=118&f%5B%5D=16&f%5B%5D=32&f%5B%5D=19&f%5B%5D=44&f%5B%5D=127&f%5B%5D=55&f%5B%5D=94&f%5B%5D=144&f%5B%5D=190&f%5B%5D=70&f%5B%5D=192&f%5B%5D=193&f%5B%5D=195&f%5B%5D=194&f%5B%5D=196&f%5B%5D=197&f%5B%5D=225&f%5B%5D=21&f%5B%5D=131&f%5B%5D=226&f%5B%5D=227&f%5B%5D=228&f%5B%5D=229&f%5B%5D=230&f%5B%5D=119&f%5B%5D=18&f%5B%5D=132&f%5B%5D=157&f%5B%5D=235&f%5B%5D=170&f%5B%5D=162&f%5B%5D=166&f%5B%5D=167&f%5B%5D=168&f%5B%5D=169&f%5B%5D=54&f%5B%5D=158&f%5B%5D=159&f%5B%5D=160&f%5B%5D=161&f%5B%5D=136&f%5B%5D=96&f%5B%5D=173&f%5B%5D=139&f%5B%5D=174&f%5B%5D=140&f%5B%5D=120&f%5B%5D=66&f%5B%5D=137&f%5B%5D=138&f%5B%5D=237&f%5B%5D=33&f%5B%5D=8&f%5B%5D=23&f%5B%5D=24&f%5B%5D=43&f%5B%5D=35&f%5B%5D=37&f%5B%5D=36&f%5B%5D=38&f%5B%5D=56&f%5B%5D=98&f%5B%5D=100&f%5B%5D=101&f%5B%5D=102&f%5B%5D=103&f%5B%5D=104&f%5B%5D=105&f%5B%5D=106&f%5B%5D=11&f%5B%5D=134&f%5B%5D=177&f%5B%5D=178&f%5B%5D=179&f%5B%5D=180&f%5B%5D=183&f%5B%5D=181&f%5B%5D=182&f%5B%5D=184&f%5B%5D=185&f%5B%5D=135&f%5B%5D=186&f%5B%5D=187&f%5B%5D=189&f%5B%5D=9&f%5B%5D=25&f%5B%5D=199&f%5B%5D=200&f%5B%5D=201&f%5B%5D=202&f%5B%5D=239&f%5B%5D=26&f%5B%5D=27&f%5B%5D=240&f%5B%5D=211&f%5B%5D=122&f%5B%5D=40&f%5B%5D=241&f%5B%5D=203&f%5B%5D=12&f%5B%5D=249&f%5B%5D=10&f%5B%5D=28&f%5B%5D=259&f%5B%5D=29&f%5B%5D=30&f%5B%5D=41&f%5B%5D=212&f%5B%5D=205&f%5B%5D=236&f%5B%5D=71&f%5B%5D=72&f%5B%5D=73&f%5B%5D=74&f%5B%5D=75&f%5B%5D=76&f%5B%5D=121&f%5B%5D=45&f%5B%5D=46&f%5B%5D=47&f%5B%5D=48&f%5B%5D=208&o=7&s=2&tm=-1&shf=1&sha=1&tcs=1&sns=-1&sds=-1&nm=';
    return `${prefix}${encodeURIComponent(englishName)}&pn=`;
  }

  /**
   * Extracts original English title from series title and/or series ID
   * Examples:
   * "Таємниця бункера / Бункер / Silo" -> "silo"
   * "Розрив / Поділ / Severance" -> "severance"
   */
  extractEnglishTitle(title: string, seriesId?: string): string {
    const parts = title.split('/').map(p => p.trim());

    // Search from right to left for a segment with Latin letters and without Cyrillic
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i];
      if (/[a-zA-Z]/.test(part) && !/[\u0400-\u04FF]/.test(part)) {
        const cleaned = part.replace(/\s*\([^)]*\)/g, '').trim();
        if (cleaned) {
          return cleaned.toLowerCase();
        }
      }
    }

    // Check parentheses, e.g. "Таємниця бункера (Silo)"
    const parenMatch = title.match(/\(([A-Za-z0-9\s:,'’.-]+)\)/);
    if (
      parenMatch &&
      /[a-zA-Z]/.test(parenMatch[1]) &&
      !/[\u0400-\u04FF]/.test(parenMatch[1])
    ) {
      const candidate = parenMatch[1].trim();
      if (!/^(?:season\s*\d+|\d{4})$/i.test(candidate)) {
        return candidate.toLowerCase();
      }
    }

    // Check seriesId (e.g. "silo", "severance")
    if (seriesId && /[a-zA-Z]/.test(seriesId) && !/[\u0400-\u04FF]/.test(seriesId)) {
      return seriesId.replace(/[-_]+/g, ' ').trim().toLowerCase();
    }

    return (parts[parts.length - 1] || title).trim().toLowerCase();
  }

  /**
   * Appends a new pending message to the Telegram Outbox queue spreadsheet
   */
  async appendTelegramOutbox(
    title: string,
    season: number,
    episode: number,
    posterUrl?: string,
    seriesId?: string
  ): Promise<void> {
    const sheets = this.getSheetsClient();
    const spreadsheetId = this.getOutboxSpreadsheetId();
    const outboxSheetName = await this.resolveOutboxSheetName();

    const timestamp = this.formatGmt3(new Date());
    const escapedTitle = this.escapeHtml(title);

    let message = '';
    if (posterUrl) {
      // Hidden link with zero-width space displays the poster at the top in Telegram
      message += `<a href="${posterUrl}">&#8205;</a>`;
    }
    message += `🔔 <b>Вийшла нова серія</b>\n\n🎬 <b>${escapedTitle}</b>\n\n📺 <b>Сезон ${season}, Серія ${episode}</b>`;

    const englishName = this.extractEnglishTitle(title, seriesId);
    if (englishName) {
      const tolokaUrl = this.buildTolokaSearchUrl(englishName);
      const escapedTolokaUrl = this.escapeHtml(tolokaUrl);
      message += `\n\n🔗 <a href="${escapedTolokaUrl}">Toloka</a>`;
    }

    const rowValues = [
      timestamp,
      message,
      '1252877',
      'HTML',
      'PENDING',
    ];

    this.logger.log(
      `Appending to Telegram Outbox sheet "${outboxSheetName}" (${spreadsheetId}): [Timestamp: ${timestamp}, Title: "${title}", Status: PENDING]`
    );

    try {
      const result = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${outboxSheetName}!A:E`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [rowValues],
        },
      });
      this.logger.log(
        `Successfully appended Telegram Outbox row for "${title}" S${season}E${episode}. Range: ${result.data.updates?.updatedRange}`
      );
    } catch (error) {
      this.logger.error(`Failed to append to Telegram Outbox: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Formats date as YYYY-MM-DD HH:mm:ss in GMT+3
   */
  private formatGmt3(date: Date): string {
    const gmt3 = new Date(date.getTime() + 3 * 60 * 60 * 1000);
    const YYYY = gmt3.getUTCFullYear();
    const MM = String(gmt3.getUTCMonth() + 1).padStart(2, '0');
    const DD = String(gmt3.getUTCDate()).padStart(2, '0');
    const hh = String(gmt3.getUTCHours()).padStart(2, '0');
    const mm = String(gmt3.getUTCMinutes()).padStart(2, '0');
    const ss = String(gmt3.getUTCSeconds()).padStart(2, '0');
    return `${YYYY}-${MM}-${DD} ${hh}:${mm}:${ss}`;
  }

  /**
   * Formats date as YYYY-MM-DD HH:mm in GMT+3
   */
  private formatGmt3Minutes(date: Date): string {
    const gmt3 = new Date(date.getTime() + 3 * 60 * 60 * 1000);
    const YYYY = gmt3.getUTCFullYear();
    const MM = String(gmt3.getUTCMonth() + 1).padStart(2, '0');
    const DD = String(gmt3.getUTCDate()).padStart(2, '0');
    const hh = String(gmt3.getUTCHours()).padStart(2, '0');
    const mm = String(gmt3.getUTCMinutes()).padStart(2, '0');
    return `${YYYY}-${MM}-${DD} ${hh}:${mm}`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
