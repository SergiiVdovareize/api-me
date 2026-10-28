import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  Logger,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { WhatsappService } from './whatsapp.service';
import { WhatsAppProcessingResult, WhatsAppWebhookPayload } from './interfaces/whatsapp.interface';

@Controller('whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(private readonly whatsappService: WhatsappService) {}

  /**
   * Webhook verification endpoint used by Meta when configuring WhatsApp Cloud API.
   */
  @Get('webhook')
  verifyWebhook(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string
  ): string {
    return this.whatsappService.verifyWebhookChallenge(mode, token, challenge);
  }

  /**
   * Inbound webhook endpoint that receives messages, voice notes, and media updates.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() payload: WhatsAppWebhookPayload,
    @Headers('x-hub-signature-256') signature?: string,
    @Req() req?: Request
  ): Promise<{ status: string; result: WhatsAppProcessingResult }> {
    // If rawBody is attached by body-parser/express, verify HMAC
    const rawBody = (req as any)?.rawBody || JSON.stringify(payload);
    if (!this.whatsappService.verifySignature(rawBody, signature)) {
      this.logger.warn('Invalid x-hub-signature-256 received on WhatsApp webhook.');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const result = await this.whatsappService.handleIncomingWebhook(payload);
    return {
      status: 'ok',
      result,
    };
  }
}
