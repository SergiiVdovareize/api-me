import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { LlmService } from '../llm/llm.service';
import { TranscriptionService } from './services/transcription.service';
import { WhatsappProjectBoardService } from './services/whatsapp-project-board.service';
import {
  StructuredTaskResult,
  WhatsAppProcessingResult,
  WhatsAppWebhookPayload,
} from './interfaces/whatsapp.interface';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly llmService: LlmService,
    private readonly transcriptionService: TranscriptionService,
    private readonly projectBoardService: WhatsappProjectBoardService
  ) {}

  /**
   * Validates Meta webhook verification challenge (GET /whatsapp/webhook).
   */
  verifyWebhookChallenge(mode?: string, token?: string, challenge?: string): string {
    const expectedToken = this.configService.get<string>('WHATSAPP_VERIFY_TOKEN')?.trim();

    if (mode === 'subscribe' && token && expectedToken && token === expectedToken) {
      this.logger.log('✅ Meta WhatsApp webhook handshake verified successfully.');
      return challenge || '';
    }

    this.logger.warn(`Failed WhatsApp webhook verification handshake. Received token: "${token}"`);
    throw new ForbiddenException('Invalid verification token or mode');
  }

  /**
   * Validates x-hub-signature-256 HMAC header if WHATSAPP_APP_SECRET is set.
   */
  verifySignature(rawBody: string | Buffer, signatureHeader?: string): boolean {
    const appSecret = this.configService.get<string>('WHATSAPP_APP_SECRET')?.trim();
    if (!appSecret) {
      return true; // Skip signature check if app secret not configured
    }

    if (!signatureHeader || !signatureHeader.startsWith('sha256=')) {
      return false;
    }

    const signature = signatureHeader.slice('sha256='.length);
    const hmac = crypto.createHmac('sha256', appSecret);
    hmac.update(rawBody);
    const expectedSignature = hmac.digest('hex');
    const sigBuf = Buffer.from(signature, 'hex');
    const expectedBuf = Buffer.from(expectedSignature, 'hex');

    if (sigBuf.length !== expectedBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(sigBuf, expectedBuf);
  }

  /**
   * Processes incoming WhatsApp messages and voice memos.
   */
  async handleIncomingWebhook(payload: WhatsAppWebhookPayload): Promise<WhatsAppProcessingResult> {
    const createdTasks: Array<{ title: string; itemId: string; sender: string }> = [];
    let processed = 0;

    if (!payload.entry || payload.entry.length === 0) {
      return { processed: 0, createdTasks: [] };
    }

    const authorizedNumbersStr = this.configService.get<string>('WHATSAPP_AUTHORIZED_NUMBERS')?.trim();
    const authorizedNumbers = authorizedNumbersStr
      ? authorizedNumbersStr.split(',').map(n => n.trim().replace(/^\+/, ''))
      : [];

    for (const entry of payload.entry) {
      for (const change of entry.changes || []) {
        const value = change.value;
        const phoneNumberId = value.metadata?.phone_number_id;
        const messages = value.messages || [];

        for (const message of messages) {
          processed++;
          const sender = message.from?.replace(/^\+/, '');

          // Authorization check
          if (authorizedNumbers.length > 0 && !authorizedNumbers.includes(sender)) {
            this.logger.warn(`Unauthorized WhatsApp sender: ${sender}. Skipping message.`);
            if (phoneNumberId) {
              await this.sendReply(
                phoneNumberId,
                sender,
                '⛔ Your phone number is not authorized to create tasks on this project board.'
              );
            }
            continue;
          }

          let rawContent = '';
          if (message.type === 'text' && message.text?.body) {
            rawContent = message.text.body.trim();
          } else if (message.type === 'audio' || message.type === 'voice') {
            const mediaId = message.audio?.id || message.voice?.id;
            const mimeType = message.audio?.mime_type || message.voice?.mime_type || 'audio/ogg';

            if (mediaId) {
              this.logger.log(`Received voice note from ${sender} (media ID: ${mediaId}). Downloading audio...`);
              const audioBuffer = await this.downloadMedia(mediaId);
              this.logger.log(`Audio downloaded (${audioBuffer.length} bytes). Transcribing...`);
              rawContent = await this.transcriptionService.transcribeAudio(audioBuffer, mimeType);
            }
          }

          if (!rawContent) {
            this.logger.debug(`No actionable text or audio in message from ${sender}. Type: ${message.type}`);
            continue;
          }

          this.logger.log(`Structuring task from dictation: "${rawContent.slice(0, 100)}..."`);
          const structured = await this.structureTaskWithLlm(rawContent);

          // Create Draft Item on GitHub Project Board #4
          const itemId = await this.projectBoardService.createDraftItem(structured.title, structured.body);
          createdTasks.push({
            title: structured.title,
            itemId,
            sender,
          });

          // Send confirmation back to user
          if (phoneNumberId) {
            const replyMsg =
              `✅ *Task added to GitHub Project Board!*\n\n` +
              `📌 *${structured.title}*\n\n` +
              `View board: https://github.com/users/SergiiVdovareize/projects/4`;
            await this.sendReply(phoneNumberId, sender, replyMsg);
          }
        }
      }
    }

    return { processed, createdTasks };
  }

  /**
   * Uses LlmService to format unstructured spoken dictation into a standard task specification.
   */
  async structureTaskWithLlm(dictation: string): Promise<StructuredTaskResult> {
    const systemPrompt = `You are an expert technical product manager and software architect.
Convert the user's spoken voice note or text dictation into a clear, professional task specification in English.
You MUST output ONLY a valid JSON object matching this structure:
{
  "title": "Concise task title with conventional commit prefix like feat(...), fix(...), or chore(...)",
  "body": "## Overview\\n1-2 sentences summarizing the goal.\\n\\n## Objectives\\n- Bulleted concrete deliverables\\n\\n## Acceptance Criteria\\n- [ ] Testable condition 1\\n- [ ] Testable condition 2\\n\\n---\\n*Task dictated via WhatsApp bot.*"
}`;

    const userPrompt = `User Dictation:\n"""\n${dictation}\n"""`;

    try {
      return await this.llmService.callAndParseJSON<StructuredTaskResult>(systemPrompt, userPrompt);
    } catch (err: any) {
      this.logger.error(`Failed to structure task with LLM: ${err.message}. Using fallback formatting.`);
      const firstLine = dictation.split('\n')[0].trim().slice(0, 80);
      return {
        title: firstLine || 'Voice Task',
        body: `## Overview\n${dictation}\n\n---\\n*Task dictated via WhatsApp bot.*`,
      };
    }
  }

  /**
   * Downloads binary audio media from Meta Graph API using access token.
   */
  async downloadMedia(mediaId: string): Promise<Buffer> {
    const accessToken = this.configService.get<string>('WHATSAPP_ACCESS_TOKEN')?.trim();
    if (!accessToken) {
      this.logger.warn('WHATSAPP_ACCESS_TOKEN not set. Returning mock audio buffer.');
      return Buffer.from('mock-audio-content');
    }

    // 1. Retrieve media download URL
    const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!metaRes.ok) {
      const err = await metaRes.text();
      this.logger.error(`Failed to get media URL from Meta (${metaRes.status}): ${err}`);
      throw new Error(`Meta media query failed: HTTP ${metaRes.status}`);
    }

    const metaData = (await metaRes.json()) as { url?: string };
    if (!metaData.url) {
      throw new Error(`Meta media response did not contain a URL for media ID ${mediaId}`);
    }

    // 2. Download media file
    const fileRes = await fetch(metaData.url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!fileRes.ok) {
      throw new Error(`Failed to download audio file stream from Meta CDN: HTTP ${fileRes.status}`);
    }

    const arrayBuffer = await fileRes.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Sends an outbound text message back to the sender via Meta Graph API.
   */
  async sendReply(phoneNumberId: string, recipientPhone: string, messageText: string): Promise<void> {
    if (phoneNumberId === '123456123' || recipientPhone === '16315551181') {
      this.logger.log(
        `Skipping WhatsApp outbound reply for Meta test event placeholder (phone ID: ${phoneNumberId}, recipient: ${recipientPhone}).`
      );
      return;
    }

    const accessToken = this.configService.get<string>('WHATSAPP_ACCESS_TOKEN')?.trim();
    if (!accessToken) {
      this.logger.warn(`WHATSAPP_ACCESS_TOKEN not configured. Skipping outbound reply to ${recipientPhone}.`);
      return;
    }

    const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: recipientPhone,
          type: 'text',
          text: {
            preview_url: false,
            body: messageText,
          },
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        this.logger.error(`Failed to send WhatsApp reply to ${recipientPhone} (${res.status}): ${err}`);
      } else {
        this.logger.log(`Outbound WhatsApp confirmation sent to ${recipientPhone}`);
      }
    } catch (err: any) {
      this.logger.error(`Error sending WhatsApp reply: ${err.message}`);
    }
  }
}
