import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmService } from '../llm/llm.service';
import { TranscriptionService } from './services/transcription.service';
import { TelegramProjectBoardService } from './services/telegram-project-board.service';
import { RedisReader } from '../common/helpers/redisReader';
import { BlobService } from '../blob/blob.service';
import { CatcastService } from '../catcast/catcast.service';
import {
  StructuredTaskResult,
  TelegramFileResponse,
  TelegramProcessingResult,
  TelegramUpdate,
} from './interfaces/telegram.interface';

function escapeHtml(text: string): string {
  return (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private readonly inMemoryAwaitingTask = new Map<number | string, number>();

  constructor(
    private readonly configService: ConfigService,
    private readonly llmService: LlmService,
    private readonly transcriptionService: TranscriptionService,
    private readonly projectBoardService: TelegramProjectBoardService,
    @Optional() private readonly redisReader?: RedisReader,
    @Optional() private readonly blobService?: BlobService,
    @Optional() private readonly catcastService?: CatcastService
  ) {}

  async onModuleInit() {
    await this.registerBotCommands();
  }

  /**
   * Registers bot commands with Telegram so they appear in the chat Menu button.
   */
  async registerBotCommands(): Promise<void> {
    const token = this.getBotToken();
    if (!token) return;

    try {
      await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commands: [
            { command: 'task', description: '➕ Створити нову задачу' },
            { command: 'catcast', description: '🐱 Ключі CatCast' },
            { command: 'cancel', description: '❌ Скасувати дію' },
            { command: 'help', description: 'ℹ️ Довідка' },
          ],
        }),
      });
      this.logger.log('Telegram bot menu commands registered successfully.');
    } catch (err: any) {
      this.logger.warn(`Failed to set Telegram bot commands: ${err.message}`);
    }
  }

  /**
   * Checks whether a chat is currently in the "awaiting task dictation" state.
   */
  async isAwaitingTask(chatId: number | string): Promise<boolean> {
    const memExpiry = this.inMemoryAwaitingTask.get(chatId);
    if (memExpiry && memExpiry > Date.now()) {
      return true;
    }

    if (this.redisReader) {
      const val = await this.redisReader.read(`telegram:awaiting_task:${chatId}`);
      if (val) {
        return true;
      }
    }

    return false;
  }

  /**
   * Sets the "awaiting task dictation" state for a chat (default 5 minutes TTL).
   */
  async setAwaitingTask(chatId: number | string, ttlSeconds = 300): Promise<void> {
    this.inMemoryAwaitingTask.set(chatId, Date.now() + ttlSeconds * 1000);
    if (this.redisReader) {
      await this.redisReader.write(`telegram:awaiting_task:${chatId}`, '1', ttlSeconds);
    }
  }

  /**
   * Clears the "awaiting task dictation" state for a chat.
   */
  async clearAwaitingTask(chatId: number | string): Promise<void> {
    this.inMemoryAwaitingTask.delete(chatId);
    if (this.redisReader) {
      await this.redisReader.delete(`telegram:awaiting_task:${chatId}`);
    }
  }

  /**
   * Verifies if a sender ID or username is permitted to interact with the bot.
   */
  isAuthorized(senderId?: number, username?: string): boolean {
    const authorizedIdsStr =
      this.configService.get<string>('BOARD_TELEGRAM_AUTHORIZED_USER_IDS')?.trim() ||
      this.configService.get<string>('TELEGRAM_AUTHORIZED_USER_IDS')?.trim();
    const authorizedUsernamesStr =
      this.configService.get<string>('BOARD_TELEGRAM_AUTHORIZED_USERNAMES')?.trim() ||
      this.configService.get<string>('TELEGRAM_AUTHORIZED_USERNAMES')?.trim();

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
    const createdTasks: Array<{
      title: string;
      itemId: string;
      senderId: string;
      username?: string;
      url?: string;
    }> = [];
    const message = update.message || update.edited_message;

    if (!message) {
      return { processed: 0, createdTasks: [] };
    }

    const chatId = message.chat.id;
    const senderId = message.from?.id;
    const username = message.from?.username;
    const senderLabel = username ? `@${username}` : senderId?.toString() || 'Unknown';

    // 1. Authorization check
    if (!this.isAuthorized(senderId, username)) {
      this.logger.warn(
        `Unauthorized Telegram message from ${senderLabel} (ID: ${senderId}). Ignoring.`
      );
      await this.sendMessage(
        chatId,
        '⛔ *Access Denied*\n\nYour Telegram account is not authorized to create tasks on this project board.'
      );
      return { processed: 1, createdTasks: [] };
    }

    const textTrimmed = (message.text || message.caption)?.trim() || '';

    // 2. Command handling: /start, /help
    if (textTrimmed === '/start' || textTrimmed === '/help') {
      const helpMessage =
        `👋 *AI Tasks Bot*\n\n` +
        `*Задачі на GitHub:*\n` +
        `• /task — створити нову задачу (голосом, текстом чи з фото)\n` +
        `• /cancel — скасувати створення задачі\n\n` +
        `*CatCast:*\n` +
        `• /catcast — керування персональними ключами доступу\n\n` +
        `Для скасування скористайтесь /cancel.`;
      await this.sendMessage(chatId, helpMessage);
      return { processed: 1, createdTasks: [] };
    }

    // 3. Command handling: /cancel
    if (textTrimmed === '/cancel') {
      await this.clearAwaitingTask(chatId);
      await this.sendMessage(chatId, '❌ *Створення задачі скасовано.*');
      return { processed: 1, createdTasks: [] };
    }

    // 4. CatCast Key Management commands
    if (textTrimmed === '/catcast' || textTrimmed.startsWith('/catcast_help')) {
      const helpMsg =
        `🐱 <b>Керування ключами CatCast</b>\n\n` +
        `• <code>/catcast_new [назва]</code> — створити новий ключ\n` +
        `  <i>Приклад: /catcast_new MiBox Вітальня</i>\n\n` +
        `• <code>/catcast_list</code> — список усіх ключів та пристроїв\n\n` +
        `• <code>/catcast_reset_[ID]</code> — скинути прив'язку пристрою\n\n` +
        `• <code>/catcast_toggle_[ID]</code> — активувати / заблокувати ключ`;
      await this.sendMessage(chatId, helpMsg, { parse_mode: 'HTML' });
      return { processed: 1, createdTasks: [] };
    }

    if (textTrimmed.startsWith('/catcast_new')) {
      if (!this.catcastService) {
        await this.sendMessage(chatId, '⚠️ Сервіс CatCast наразі недоступний.');
        return { processed: 1, createdTasks: [] };
      }

      const rawLabel = textTrimmed.replace(/^\/catcast_new(@\w+)?/i, '').trim();
      const label = rawLabel || 'Новий пристрій';

      try {
        const created = await this.catcastService.createKey(label);
        const reply =
          `✅ <b>Ключ CatCast успішно створено!</b>\n\n` +
          `👤 Назва: <b>${escapeHtml(created.label || 'Без назви')}</b>\n` +
          `🔑 Ключ: <code>${created.key}</code>\n\n` +
          `<i>(Натисніть на ключ, щоб скопіювати)</i>`;
        await this.sendMessage(chatId, reply, { parse_mode: 'HTML' });
      } catch (err: any) {
        await this.sendMessage(chatId, `❌ Не вдалося створити ключ: ${escapeHtml(err.message)}`, {
          parse_mode: 'HTML',
        });
      }
      return { processed: 1, createdTasks: [] };
    }

    if (textTrimmed === '/catcast_list' || textTrimmed.startsWith('/catcast_list@')) {
      if (!this.catcastService) {
        await this.sendMessage(chatId, '⚠️ Сервіс CatCast наразі недоступний.');
        return { processed: 1, createdTasks: [] };
      }

      try {
        const keys = await this.catcastService.listKeys();
        if (keys.length === 0) {
          await this.sendMessage(
            chatId,
            'ℹ️ <b>Список ключів CatCast порожній.</b>\nСтворіть перший ключ: <code>/catcast_new [назва]</code>',
            { parse_mode: 'HTML' }
          );
          return { processed: 1, createdTasks: [] };
        }

        const items = keys.map((k, idx) => {
          const statusIcon = k.isActive ? '🟢' : '🔴';
          const safeLabel = escapeHtml(k.label || 'Без назви');
          const deviceText = k.boundDeviceId
            ? `📱 <code>${escapeHtml(k.boundDeviceId.slice(0, 18))}...</code> (${escapeHtml(k.platform || 'web')})`
            : `📱 <i>Пристрій не прив'язано</i>`;
          const lastUsed = k.lastUsedAt
            ? `🕒 ${new Date(k.lastUsedAt).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
            : '';

          return (
            `${idx + 1}. ${statusIcon} <b>${safeLabel}</b> (ID: ${k.id})\n` +
            `   🔑 <code>${k.key}</code>\n` +
            `   ${deviceText} ${lastUsed}\n` +
            `   Дії: /catcast_reset_${k.id} | /catcast_toggle_${k.id}`
          );
        });

        const listReply =
          `📋 <b>Ключі доступу CatCast (${keys.length}):</b>\n\n` + items.join('\n\n');
        await this.sendMessage(chatId, listReply, { parse_mode: 'HTML' });
      } catch (err: any) {
        await this.sendMessage(
          chatId,
          `❌ Помилка завантаження ключів: ${escapeHtml(err.message)}`,
          {
            parse_mode: 'HTML',
          }
        );
      }
      return { processed: 1, createdTasks: [] };
    }

    if (textTrimmed.startsWith('/catcast_reset')) {
      if (!this.catcastService) {
        await this.sendMessage(chatId, '⚠️ Сервіс CatCast наразі недоступний.');
        return { processed: 1, createdTasks: [] };
      }

      const idOrKey = textTrimmed
        .replace(/^\/catcast_reset_(@\w+)?/i, '')
        .replace(/^\/catcast_reset(@\w+)?/i, '')
        .replace(/^_/, '')
        .trim();

      if (!idOrKey) {
        await this.sendMessage(
          chatId,
          'ℹ️ Вкажіть ID або ключ для скидання: <code>/catcast_reset_[ID]</code> або <code>/catcast_reset [ключ]</code>',
          { parse_mode: 'HTML' }
        );
        return { processed: 1, createdTasks: [] };
      }

      try {
        const res = await this.catcastService.resetKeyBinding(idOrKey);
        await this.sendMessage(
          chatId,
          `🔄 <b>Прив'язку пристрою скинуто!</b>\n\n` +
            `🔑 Ключ: <code>${res.key}</code>\n` +
            `👤 Назва: <b>${escapeHtml(res.label || '-')}</b>\n\n` +
            `Тепер цей ключ можна активувати на новому пристрої.`,
          { parse_mode: 'HTML' }
        );
      } catch (err: any) {
        await this.sendMessage(
          chatId,
          `❌ Не вдалося скинути прив'язку: ${escapeHtml(err.message)}`,
          {
            parse_mode: 'HTML',
          }
        );
      }
      return { processed: 1, createdTasks: [] };
    }

    if (textTrimmed.startsWith('/catcast_toggle')) {
      if (!this.catcastService) {
        await this.sendMessage(chatId, '⚠️ Сервіс CatCast наразі недоступний.');
        return { processed: 1, createdTasks: [] };
      }

      const idOrKey = textTrimmed
        .replace(/^\/catcast_toggle_(@\w+)?/i, '')
        .replace(/^\/catcast_toggle(@\w+)?/i, '')
        .replace(/^_/, '')
        .trim();

      if (!idOrKey) {
        await this.sendMessage(
          chatId,
          'ℹ️ Вкажіть ID або ключ: <code>/catcast_toggle_[ID]</code> або <code>/catcast_toggle [ключ]</code>',
          { parse_mode: 'HTML' }
        );
        return { processed: 1, createdTasks: [] };
      }

      try {
        const updated = await this.catcastService.toggleKey(idOrKey);
        const icon = updated.isActive ? '🟢' : '🔴';
        const action = updated.isActive ? 'активовано' : 'заблоковано';
        await this.sendMessage(
          chatId,
          `${icon} Ключ <code>${updated.key}</code> (<b>${escapeHtml(updated.label || '-')}</b>) успішно <b>${action}</b>!`,
          { parse_mode: 'HTML' }
        );
      } catch (err: any) {
        await this.sendMessage(chatId, `❌ Не вдалося змінити статус: ${escapeHtml(err.message)}`, {
          parse_mode: 'HTML',
        });
      }
      return { processed: 1, createdTasks: [] };
    }

    // 5. Command handling: /task (Variant A prompt initiation)
    if (textTrimmed === '/task' || textTrimmed.startsWith('/task@')) {
      await this.setAwaitingTask(chatId);
      await this.sendMessage(
        chatId,
        '🎙️ *Записуйте голосове, фото з підписом або пишіть текст задачі...*\n\n_(Очікую ваше повідомлення протягом 5 хвилин)_'
      );
      return { processed: 1, createdTasks: [] };
    }

    // 5. Verification of Variant A: is the user currently awaiting task input?
    const isAwaiting = await this.isAwaitingTask(chatId);
    if (!isAwaiting) {
      await this.sendMessage(
        chatId,
        'ℹ️ Щоб створити задачу, спочатку виберіть команду /task у меню.'
      );
      return { processed: 1, createdTasks: [] };
    }

    // Clear awaiting state since input is now received
    await this.clearAwaitingTask(chatId);

    // 6. Extract attached photo (if present) and upload to Blob
    let attachedImageUrl: string | null = null;
    if (message.photo && Array.isArray(message.photo) && message.photo.length > 0) {
      const largestPhoto = message.photo[message.photo.length - 1];
      if (largestPhoto?.file_id) {
        this.logger.log(
          `Received photo from ${senderLabel} (file ID: ${largestPhoto.file_id}). Downloading...`
        );
        try {
          const photoBuffer = await this.downloadFile(largestPhoto.file_id);
          if (this.blobService) {
            const filename = `tasks/telegram-photo-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.jpg`;
            attachedImageUrl = await this.blobService.upload(filename, photoBuffer, 'image/jpeg');
            this.logger.log(`Photo uploaded to Blob: ${attachedImageUrl}`);
          }
        } catch (photoErr: any) {
          this.logger.warn(`Failed to process photo attachment: ${photoErr.message}`);
        }
      }
    }

    // 7. Extract text or transcribe audio
    let rawContent = textTrimmed;

    if (!rawContent && (message.voice || message.audio)) {
      const voiceObj = message.voice || message.audio;
      const fileId = voiceObj?.file_id;
      const mimeType = voiceObj?.mime_type || 'audio/ogg';

      if (fileId) {
        this.logger.log(
          `Received voice memo from ${senderLabel} (file ID: ${fileId}). Downloading audio...`
        );
        const audioBuffer = await this.downloadFile(fileId);
        this.logger.log(
          `Audio downloaded (${audioBuffer.length} bytes). Transcribing with Whisper...`
        );
        rawContent = await this.transcriptionService.transcribeAudio(audioBuffer, mimeType);
      }
    } else if (!rawContent && attachedImageUrl) {
      rawContent = 'Задача зі знімком екрана / фотографією';
    }

    if (!rawContent && !attachedImageUrl) {
      this.logger.debug(
        `No actionable text, photo, or voice content found in update from ${senderLabel}.`
      );
      await this.sendMessage(
        chatId,
        '⚠️ Не вдалося розпізнати текст, фото або аудіо. Спробуйте ще раз через /task.'
      );
      return { processed: 1, createdTasks: [] };
    }

    // 8. Structure task via LLM
    this.logger.log(`Structuring task for ${senderLabel}: "${rawContent.slice(0, 80)}..."`);
    const structured = await this.structureTaskWithLlm(rawContent);

    let finalBody = structured.body;
    if (attachedImageUrl) {
      finalBody += `\n\n### 🖼️ Прикріплене зображення\n![Прикріплене зображення](${attachedImageUrl})`;
    }

    // 9. Create Draft Item on GitHub Project Board #4
    const created = await this.projectBoardService.createDraftItem(structured.title, finalBody);
    createdTasks.push({
      title: structured.title,
      itemId: created.itemId,
      senderId: senderId?.toString() || '',
      username,
      url: created.url,
    });

    // 10. Send concise confirmation back to user (ONLY the title and direct link to the created task)
    const confirmationText =
      `📌 *${structured.title}*\n\n` + `🔗 [Відкрити задачу](${created.url})`;

    await this.sendMessage(chatId, confirmationText);

    return { processed: 1, createdTasks };
  }

  /**
   * Formats raw dictation into a structured task specification using LLM.
   */
  async structureTaskWithLlm(dictation: string): Promise<StructuredTaskResult> {
    const systemPrompt = `You are an attentive assistant that captures thoughts, ideas, and tasks from spoken voice notes or text dictation.
Your goal is to clearly record and structure the author's thoughts WITHOUT losing their core idea and WITHOUT over-engineering.

CRITICAL RULES:
1. LANGUAGE: Keep EVERYTHING in the EXACT SAME LANGUAGE as the user's dictation (e.g. if Ukrainian, output title and body in Ukrainian; if English, in English). Never translate to another language.
2. NO OVER-ENGINEERING: Do NOT invent edge cases, unit tests, acceptance criteria checklists, or technical specifications that were not explicitly stated. The goal is idea capture, not premature software architecture.
3. CONCISE TITLE: Create a clear, meaningful title representing the essence of the idea (in the original language).
4. VERBATIM QUOTE: Include the raw dictation verbatim in the dedicated block so zero original context is lost.

You MUST output ONLY a valid JSON object matching this structure:
{
  "title": "Короткий, змістовний заголовок задачі мовою оригіналу",
  "body": "## Суть ідеї\\n1-2 чітких речення, що описують мету або задум автора.\\n\\n## Ключові тези\\n- Головна думка або важливий контекст із почутого\\n- Інші озвучені деталі (виключно те, що згадувалось)\\n\\n> [!NOTE]\\n> **Оригінальний запис:**\\n> \\"{user dictation verbatim}\\"\\n\\n---\\n*Task dictated via Telegram bot.*"
}`;

    const userPrompt = `User Dictation:\n"""\n${dictation}\n"""`;

    try {
      return await this.llmService.callAndParseJSON<StructuredTaskResult>(systemPrompt, userPrompt);
    } catch (err: any) {
      this.logger.error(
        `Failed to structure task with LLM: ${err.message}. Using fallback formatting.`
      );
      const firstLine = dictation.split('\n')[0].trim().slice(0, 80);
      return {
        title: firstLine || 'Нова задача',
        body: `## Суть ідеї\n${dictation}\n\n---\n*Task dictated via Telegram bot.*`,
      };
    }
  }

  /**
   * Returns the configured bot token, checking both BOARD_TELEGRAM_BOT_TOKEN and TELEGRAM_BOT_TOKEN.
   */
  private getBotToken(): string | undefined {
    return (
      this.configService.get<string>('BOARD_TELEGRAM_BOT_TOKEN')?.trim() ||
      this.configService.get<string>('TELEGRAM_BOT_TOKEN')?.trim()
    );
  }

  /**
   * Downloads a binary file (such as voice memo audio) from Telegram Bot API.
   */
  async downloadFile(fileId: string): Promise<Buffer> {
    const token = this.getBotToken();
    if (!token) {
      this.logger.warn('TELEGRAM_BOT_TOKEN not configured. Returning mock audio buffer.');
      return Buffer.from('mock-audio-buffer');
    }

    // 1. Get file path from Telegram
    const getFileUrl = `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`;
    const metaRes = await fetch(getFileUrl);

    if (!metaRes.ok) {
      const err = await metaRes.text();
      this.logger.error(
        `Failed to get file metadata from Telegram (HTTP ${metaRes.status}): ${err}`
      );
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
    const token = this.getBotToken();
    if (!token) {
      this.logger.warn(
        `Neither BOARD_TELEGRAM_BOT_TOKEN nor TELEGRAM_BOT_TOKEN configured. Skipping sendMessage to chat ${chatId}.`
      );
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
        this.logger.error(
          `Failed to send Telegram message to chat ${chatId} (HTTP ${res.status}): ${err}`
        );

        // Fallback: If Telegram rejected due to markdown/entity parsing error, retry as plain text
        if (options.parse_mode && err.includes("can't parse entities")) {
          this.logger.warn(`Retrying sending Telegram message to chat ${chatId} as plain text...`);
          try {
            await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ chat_id: chatId, text }),
            });
          } catch {
            // ignore retry error
          }
        }
      } else {
        this.logger.log(`Telegram message sent successfully to chat ${chatId}`);
      }
    } catch (err: any) {
      this.logger.error(`Error sending Telegram message: ${err.message}`);
    }
  }
}
