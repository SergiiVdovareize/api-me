import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmService } from '../llm/llm.service';
import { TranscriptionService } from './services/transcription.service';
import { TelegramProjectBoardService } from './services/telegram-project-board.service';
import {
  StructuredTaskResult,
  TelegramFileResponse,
  TelegramProcessingResult,
  TelegramUpdate,
} from './interfaces/telegram.interface';

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly llmService: LlmService,
    private readonly transcriptionService: TranscriptionService,
    private readonly projectBoardService: TelegramProjectBoardService
  ) {}

  /**
   * Verifies if a sender ID or username is permitted to interact with the bot.
   */
  isAuthorized(senderId?: number, username?: string): boolean {
    const authorizedIdsStr = this.configService.get<string>('TELEGRAM_AUTHORIZED_USER_IDS')?.trim();
    const authorizedUsernamesStr = this.configService.get<string>('TELEGRAM_AUTHORIZED_USERNAMES')?.trim();

    // If no whitelist is configured, allow all
    if (!authorizedIdsStr && !authorizedUsernamesStr) {
      return true;
    }

    if (authorizedIdsStr && senderId !== undefined) {
      const allowedIds = authorizedIdsStr.split(',').map(id => id.trim());
      if (allowedIds.includes(senderId.toString())) {
        return true;
      }
    }

    if (authorizedUsernamesStr && username) {
      const allowedUsernames = authorizedUsernamesStr
        .split(',')
        .map(u => u.trim().toLowerCase().replace(/^@/, ''));
      if (allowedUsernames.includes(username.toLowerCase().replace(/^@/, ''))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Main entry point for processing incoming Telegram updates from the webhook.
   */
  async handleIncomingUpdate(update: TelegramUpdate): Promise<TelegramProcessingResult> {
    const createdTasks: Array<{ title: string; itemId: string; senderId: string; username?: string }> = [];
    const message = update.message || update.edited_message;

    if (!message) {
      return { processed: 0, createdTasks: [] };
    }

    const chatId = message.chat.id;
    const senderId = message.from?.id;
    const username = message.from?.username;
    const senderLabel = username ? `@${username}` : (senderId?.toString() || 'Unknown');

    // 1. Authorization check
    if (!this.isAuthorized(senderId, username)) {
      this.logger.warn(`Unauthorized Telegram message from ${senderLabel} (ID: ${senderId}). Ignoring.`);
      await this.sendMessage(
        chatId,
        '⛔ *Access Denied*\n\nYour Telegram account is not authorized to create tasks on this project board.'
      );
      return { processed: 1, createdTasks: [] };
    }

    // 2. Command handling (/start, /help)
    const textTrimmed = message.text?.trim() || '';
    if (textTrimmed === '/start' || textTrimmed === '/help') {
      const helpMessage =
        `👋 *Welcome to AI Tasks Bot!*\n\n` +
        `Send me a **text message** or record a **voice memo**, and I will automatically:\n` +
        `1. 🎙️ Transcribe your voice with Whisper AI\n` +
        `2. 🧠 Structure your dictation into an actionable specification\n` +
        `3. 📌 Create a task card directly on [GitHub Project Board #4](https://github.com/users/SergiiVdovareize/projects/4).\n\n` +
        `Just speak or type your task idea to get started!`;
      await this.sendMessage(chatId, helpMessage);
      return { processed: 1, createdTasks: [] };
    }

    // 3. Extract text or transcribe audio
    let rawContent = '';

    if (message.text) {
      rawContent = message.text.trim();
    } else if (message.voice || message.audio) {
      const voiceObj = message.voice || message.audio;
      const fileId = voiceObj?.file_id;
      const mimeType = voiceObj?.mime_type || 'audio/ogg';

      if (fileId) {
        this.logger.log(`Received voice memo from ${senderLabel} (file ID: ${fileId}). Downloading audio...`);
        const audioBuffer = await this.downloadFile(fileId);
        this.logger.log(`Audio downloaded (${audioBuffer.length} bytes). Transcribing with Whisper...`);
        rawContent = await this.transcriptionService.transcribeAudio(audioBuffer, mimeType);
      }
    }

    if (!rawContent) {
      this.logger.debug(`No actionable text or voice content found in update from ${senderLabel}.`);
      return { processed: 1, createdTasks: [] };
    }

    // 4. Send "processing..." feedback message
    await this.sendMessage(chatId, `⏳ *Processing your task...*\n\n_Dictation:_ "${rawContent.slice(0, 100)}${rawContent.length > 100 ? '...' : ''}"`);

    // 5. Structure task via LLM
    this.logger.log(`Structuring task for ${senderLabel}: "${rawContent.slice(0, 80)}..."`);
    const structured = await this.structureTaskWithLlm(rawContent);

    // 6. Create Draft Item on GitHub Project Board #4
    const itemId = await this.projectBoardService.createDraftItem(structured.title, structured.body);
    createdTasks.push({
      title: structured.title,
      itemId,
      senderId: senderId?.toString() || '',
      username,
    });

    // 7. Send confirmation back to user
    const confirmationText =
      `✅ *Task added to GitHub Project Board!*\n\n` +
      `📌 *${structured.title}*\n\n` +
      `📋 *Description:*\n${structured.body.slice(0, 500)}${structured.body.length > 500 ? '...' : ''}\n\n` +
      `🔗 [Open Project Board #4](https://github.com/users/SergiiVdovareize/projects/4)`;

    await this.sendMessage(chatId, confirmationText);

    return { processed: 1, createdTasks };
  }

  /**
   * Formats raw dictation into a structured task specification using LLM.
   */
  async structureTaskWithLlm(dictation: string): Promise<StructuredTaskResult> {
    const systemPrompt = `You are an expert technical product manager and software architect.
Convert the user's spoken voice note or text dictation into a clear, professional task specification in English.
You MUST output ONLY a valid JSON object matching this structure:
{
  "title": "Concise task title with conventional commit prefix like feat(...), fix(...), or chore(...)",
  "body": "## Overview\\n1-2 sentences summarizing the goal.\\n\\n## Objectives\\n- Bulleted concrete deliverables\\n\\n## Acceptance Criteria\\n- [ ] Testable condition 1\\n- [ ] Testable condition 2\\n\\n---\\n*Task dictated via Telegram bot.*"
}`;

    const userPrompt = `User Dictation:\n"""\n${dictation}\n"""`;

    try {
      return await this.llmService.callAndParseJSON<StructuredTaskResult>(systemPrompt, userPrompt);
    } catch (err: any) {
      this.logger.error(`Failed to structure task with LLM: ${err.message}. Using fallback formatting.`);
      const firstLine = dictation.split('\n')[0].trim().slice(0, 80);
      return {
        title: firstLine || 'Voice Task',
        body: `## Overview\n${dictation}\n\n---\\n*Task dictated via Telegram bot.*`,
      };
    }
  }

  /**
   * Downloads a binary file (such as voice memo audio) from Telegram Bot API.
   */
  async downloadFile(fileId: string): Promise<Buffer> {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN')?.trim();
    if (!token) {
      this.logger.warn('TELEGRAM_BOT_TOKEN not configured. Returning mock audio buffer.');
      return Buffer.from('mock-audio-buffer');
    }

    // 1. Get file path from Telegram
    const getFileUrl = `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`;
    const metaRes = await fetch(getFileUrl);

    if (!metaRes.ok) {
      const err = await metaRes.text();
      this.logger.error(`Failed to get file metadata from Telegram (HTTP ${metaRes.status}): ${err}`);
      throw new Error(`Telegram getFile failed: HTTP ${metaRes.status}`);
    }

    const fileMeta = (await metaRes.json()) as TelegramFileResponse;
    const filePath = fileMeta.result?.file_path;

    if (!filePath) {
      throw new Error(`Telegram getFile response did not contain file_path for file ID ${fileId}`);
    }

    // 2. Download binary file
    const downloadUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
    const fileRes = await fetch(downloadUrl);

    if (!fileRes.ok) {
      throw new Error(`Failed to download audio from Telegram CDN (HTTP ${fileRes.status})`);
    }

    const arrayBuffer = await fileRes.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Sends a message to a Telegram chat using Telegram Bot API.
   */
  async sendMessage(
    chatId: number | string,
    text: string,
    options: { parse_mode?: string } = { parse_mode: 'Markdown' }
  ): Promise<void> {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN')?.trim();
    if (!token) {
      this.logger.warn(`TELEGRAM_BOT_TOKEN not configured. Skipping sendMessage to chat ${chatId}.`);
      return;
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: options.parse_mode,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        this.logger.error(`Failed to send Telegram message to chat ${chatId} (HTTP ${res.status}): ${err}`);
      } else {
        this.logger.log(`Telegram message sent successfully to chat ${chatId}`);
      }
    } catch (err: any) {
      this.logger.error(`Error sending Telegram message: ${err.message}`);
    }
  }
}
