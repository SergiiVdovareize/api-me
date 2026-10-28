import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TelegramService } from './telegram.service';
import { TelegramUpdate } from './interfaces/telegram.interface';

@Controller('telegram')
export class TelegramController {
  private readonly logger = new Logger(TelegramController.name);

  constructor(
    private readonly telegramService: TelegramService,
    private readonly configService: ConfigService
  ) {}

  /**
   * Health check and diagnostics endpoint for Telegram webhook.
   */
  @Get('webhook')
  getWebhookHealth() {
    return {
      status: 'ok',
      service: 'telegram-webhook',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Main webhook endpoint called by Telegram when a user sends a message or voice note.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() update: TelegramUpdate,
    @Headers('x-telegram-bot-api-secret-token') secretToken?: string
  ) {
    const configuredSecret = this.configService.get<string>('TELEGRAM_BOT_SECRET_TOKEN')?.trim();

    if (configuredSecret && secretToken !== configuredSecret) {
      this.logger.warn('Rejected incoming Telegram webhook: invalid secret token header.');
      throw new ForbiddenException('Invalid Telegram secret token');
    }

    try {
      const result = await this.telegramService.handleIncomingUpdate(update);
      return {
        status: 'ok',
        result,
      };
    } catch (err: any) {
      this.logger.error(`Error processing Telegram update: ${err.message}`, err.stack);
      // Return 200 OK so Telegram does not continually retry failing updates
      return {
        status: 'error',
        message: err.message,
      };
    }
  }
}
