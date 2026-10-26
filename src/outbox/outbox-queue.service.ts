import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google, sheets_v4 } from 'googleapis';
import { TelegramService } from './telegram.service';

export interface OutboxProcessDetail {
  row: number;
  chatId?: string;
  status: 'SENT' | 'ERROR';
  error?: string;
}

export interface OutboxProcessResult {
  totalRows: number;
  processed: number;
  sent: number;
  errors: number;
  details: OutboxProcessDetail[];
}

@Injectable()
export class OutboxQueueService {
  private readonly logger = new Logger(OutboxQueueService.name);
  private sheets: sheets_v4.Sheets | null = null;
  private readonly defaultOutboxSpreadsheetId = '1zbsVKCvuaFgN4cbn9KNeRKSq3EOT5tsMq2yp6Mpd9dI';
  private cachedOutboxSheetName: string | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly telegramService: TelegramService
  ) {}

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
   * Reads pending messages from the Outbox spreadsheet, sends them via Telegram,
   * and updates row status to SENT or ERROR.
   */
  async processOutboxQueue(): Promise<OutboxProcessResult> {
    const sheets = this.getSheetsClient();
    const spreadsheetId = this.getOutboxSpreadsheetId();
    const outboxSheetName = await this.resolveOutboxSheetName();

    this.logger.log(
      `Fetching pending Telegram messages from "${outboxSheetName}" (${spreadsheetId})...`
    );

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${outboxSheetName}!A:F`,
    });

    const rows = res.data.values || [];
    this.logger.log(`Found ${rows.length} total rows in Telegram Outbox`);

    let sent = 0;
    let errors = 0;
    const details: OutboxProcessDetail[] = [];

    // Skip row 0 (header row)
    for (let i = 1; i < rows.length; i++) {
      const rowIndex = i + 1; // 1-indexed in Google Sheets
      const [timeCol, messageCol, chatCol, modeCol, statusCol] = rows[i] || [];
      const message = messageCol ? String(messageCol).trim() : '';
      const chatId = chatCol ? String(chatCol).trim() : undefined;
      const parseMode = modeCol ? String(modeCol).trim() : 'HTML';
      const status = statusCol ? String(statusCol).trim() : '';

      if (status === 'PENDING' && message) {
        this.logger.log(
          `Sending message at row ${rowIndex} to chat: ${chatId || 'DEFAULT'} (parseMode: ${parseMode})`
        );
        try {
          await this.telegramService.sendMessage(message, chatId, parseMode);
          const sentAt = this.formatGmt3(new Date());

          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${outboxSheetName}!E${rowIndex}:F${rowIndex}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
              values: [['SENT', sentAt]],
            },
          });

          this.logger.log(`Row ${rowIndex} successfully sent to Telegram`);
          sent++;
          details.push({ row: rowIndex, chatId, status: 'SENT' });
        } catch (error: any) {
          this.logger.error(
            `Failed to send row ${rowIndex} to Telegram: ${error.message}`,
            error.stack
          );

          try {
            await sheets.spreadsheets.values.update({
              spreadsheetId,
              range: `${outboxSheetName}!E${rowIndex}`,
              valueInputOption: 'USER_ENTERED',
              requestBody: {
                values: [['ERROR']],
              },
            });
          } catch (updateErr: any) {
            this.logger.error(
              `Failed to update status to ERROR for row ${rowIndex}: ${updateErr.message}`
            );
          }

          errors++;
          details.push({ row: rowIndex, chatId, status: 'ERROR', error: error.message });
        }
      }
    }

    const summary: OutboxProcessResult = {
      totalRows: rows.length,
      processed: sent + errors,
      sent,
      errors,
      details,
    };

    this.logger.log(
      `Finished Telegram Outbox processing. Processed: ${summary.processed}, Sent: ${summary.sent}, Errors: ${summary.errors}`
    );

    return summary;
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
