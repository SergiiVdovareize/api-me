import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, sheets_v4 } from 'googleapis';

@Injectable()
export class OutboxQueueService {
  private readonly logger = new Logger(OutboxQueueService.name);
  private sheets: sheets_v4.Sheets | null = null;
  private readonly defaultOutboxSpreadsheetId = '1zbsVKCvuaFgN4cbn9KNeRKSq3EOT5tsMq2yp6Mpd9dI';
  private cachedOutboxSheetName: string | null = null;

  constructor(private readonly configService: ConfigService) {}

  /**
   * Appends an arbitrary pending HTML message to the Telegram Outbox queue spreadsheet.
   */
  async appendMessageToOutbox(message: string, chatId = '1252877'): Promise<void> {
    const sheets = this.getSheetsClient();
    const spreadsheetId = this.getOutboxSpreadsheetId();
    const outboxSheetName = await this.resolveOutboxSheetName();

    const timestamp = this.formatGmt3(new Date());
    const rowValues = [timestamp, message, chatId, 'HTML', 'PENDING'];

    this.logger.log(
      `Appending to Telegram Outbox sheet "${outboxSheetName}" (${spreadsheetId}): [Timestamp: ${timestamp}, Chat: ${chatId}, Status: PENDING]`
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
        `Successfully appended Telegram Outbox row. Range: ${result.data.updates?.updatedRange}`
      );
    } catch (error: any) {
      this.logger.error(`Failed to append to Telegram Outbox: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Resolves the Outbox spreadsheet ID from configuration or fallback default.
   */
  private getOutboxSpreadsheetId(): string {
    const id =
      this.configService.get<string>('TELEGRAM_OUTBOX_SPREADSHEET_ID') ||
      this.defaultOutboxSpreadsheetId;
    return id.trim();
  }

  /**
   * Dynamically resolves the outbox sheet name in the spreadsheet (matches 'queue' or 'outbox').
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

      const matched = sheetTitles.find(t => /telegram.*outbox|outbox|queue/i.test(t));

      if (matched) {
        this.cachedOutboxSheetName = matched;
        this.logger.log(`Resolved Outbox sheet tab: "${matched}"`);
        return matched;
      }

      this.cachedOutboxSheetName = sheetTitles[0] || 'queue';
      this.logger.log(`Using default Outbox tab name: "${this.cachedOutboxSheetName}"`);
      return this.cachedOutboxSheetName;
    } catch (error: any) {
      this.logger.warn(`Could not fetch Outbox metadata: ${error.message}. Defaulting to 'queue'`);
      return 'queue';
    }
  }

  /**
   * Initializes or returns cached Google Sheets API client.
   */
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

    // Fix escaped newlines if passed in environment
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
   * Formats date as YYYY-MM-DD HH:mm:ss in GMT+3.
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
}
