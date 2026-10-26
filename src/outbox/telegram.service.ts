import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SendTelegramOptions {
  chatId?: string;
  parseMode?: string;
  disableWebPagePreview?: boolean;
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly defaultChatId = '1252877';
  private readonly maxChunkLength = 4000;

  constructor(private readonly configService: ConfigService) {}

  getBotToken(): string {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) {
      throw new Error(
        'TELEGRAM_BOT_TOKEN is not configured. Please set TELEGRAM_BOT_TOKEN in your environment.'
      );
    }
    return token.trim();
  }

  getDefaultChatId(): string {
    return (
      this.configService.get<string>('TELEGRAM_DEFAULT_CHAT_ID')?.trim() ||
      this.defaultChatId
    );
  }

  /**
   * Splits text into chunks of at most maxLength characters.
   */
  splitTextIntoChunks(text: string, maxLength = this.maxChunkLength): string[] {
    if (!text || text.length <= maxLength) {
      return [text || ''];
    }
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += maxLength) {
      chunks.push(text.substring(i, i + maxLength));
    }
    return chunks;
  }

  /**
   * Sends a message to Telegram, splitting into chunks if necessary.
   */
  async sendMessage(
    text: string,
    chatId?: string,
    parseMode = 'HTML',
    disableWebPagePreview = false
  ): Promise<void> {
    const token = this.getBotToken();
    const targetChatId = (chatId && String(chatId).trim()) || this.getDefaultChatId();
    const chunks = this.splitTextIntoChunks(text);
    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    for (let idx = 0; idx < chunks.length; idx++) {
      const chunk = chunks[idx];
      const payload = {
        chat_id: targetChatId,
        text: chunk,
        parse_mode: parseMode || 'HTML',
        disable_web_page_preview: disableWebPagePreview,
      };

      this.logger.debug(
        `Sending Telegram message chunk ${idx + 1}/${chunks.length} to chat ${targetChatId}`
      );

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Telegram API responded with status ${response.status}: ${errorBody}`);
      }

      const data = (await response.json()) as { ok: boolean; description?: string };
      if (!data.ok) {
        throw new Error(data.description || 'Telegram API returned unsuccessful status');
      }
    }
  }
}
