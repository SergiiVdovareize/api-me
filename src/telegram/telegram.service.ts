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
  TelegramCallbackQuery,
  TelegramFileResponse,
  TelegramInlineKeyboardMarkup,
  TelegramProcessingResult,
  TelegramReplyKeyboardMarkup,
  TelegramUpdate,
} from './interfaces/telegram.interface';

function escapeHtml(text: string): string {
  return (text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const KEYBOARDS = {
  mainMenu: {
    inline_keyboard: [
      [
        { text: '📋 Задачі (GitHub)', callback_data: 'menu_tasks' },
        { text: '🐱 Ключі CatCast', callback_data: 'menu_catcast' },
      ],
      [{ text: 'ℹ️ Довідка', callback_data: 'menu_help' }],
    ],
  },
  tasksMenu: {
    inline_keyboard: [
      [
        { text: '🎙️ Створити задачу', callback_data: 'action_task_create' },
        { text: '❌ Скасувати', callback_data: 'action_task_cancel' },
      ],
      [{ text: '⬅️ Головне меню', callback_data: 'menu_main' }],
    ],
  },
  catcastMenu: {
    inline_keyboard: [
      [
        { text: '➕ Створити ключ', callback_data: 'catcast_new_menu' },
        { text: '📋 Список ключів', callback_data: 'catcast_list' },
      ],
      [{ text: 'ℹ️ Довідка по командах', callback_data: 'catcast_help' }],
      [{ text: '⬅️ Головне меню', callback_data: 'menu_main' }],
    ],
  },
  catcastNewMenu: {
    inline_keyboard: [
      [{ text: '⚡ Швидкий ключ', callback_data: 'catcast_quick_create' }],
      [{ text: '⬅️ Назад до CatCast', callback_data: 'menu_catcast' }],
    ],
  },
};

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
            { command: 'menu', description: '📱 Головне меню' },
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
    // 0. Handle inline keyboard callback queries
    if (update.callback_query) {
      return this.handleCallbackQuery(update.callback_query);
    }

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

    // 2. Command handling: /menu
    if (textTrimmed === '/menu') {
      await this.sendMessage(chatId, this.getMainMenuText(), {
        parse_mode: 'HTML',
        reply_markup: KEYBOARDS.mainMenu,
      });
      return { processed: 1, createdTasks: [] };
    }

    // 3. Command handling: /start, /help
    if (textTrimmed === '/start' || textTrimmed === '/help') {
      const helpMessage =
        `👋 *AI Tasks Bot*\n\n` +
        `*Задачі на GitHub:*\n` +
        `• /task — створити нову задачу (голосом, текстом чи з фото)\n` +
        `• /cancel — скасувати створення задачі\n\n` +
        `*CatCast:*\n` +
        `• /catcast — керування персональними ключами доступу\n` +
        `• /menu — відкрити меню з кнопками\n\n` +
        `Для скасування скористайтесь /cancel.`;
      await this.sendMessage(chatId, helpMessage, {
        parse_mode: 'Markdown',
        reply_markup: KEYBOARDS.mainMenu,
      });
      return { processed: 1, createdTasks: [] };
    }

    // 4. Command handling: /cancel
    if (textTrimmed === '/cancel') {
      await this.clearAwaitingTask(chatId);
      await this.sendMessage(chatId, '❌ *Створення задачі скасовано.*');
      return { processed: 1, createdTasks: [] };
    }

    // 5. CatCast Key Management commands
    if (textTrimmed === '/catcast' || textTrimmed.startsWith('/catcast_help')) {
      await this.sendMessage(chatId, this.getCatcastMenuText(), {
        parse_mode: 'HTML',
        reply_markup: KEYBOARDS.catcastMenu,
      });
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
          `🔑 Ключ: <code>${created.key}</code>\n` +
          `⏳ Дійсний для першої активації: <b>24 години</b>\n\n` +
          `<i>(Натисніть на ключ, щоб скопіювати)</i>`;
        await this.sendMessage(chatId, reply, {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '📋 Список ключів', callback_data: 'catcast_list' },
                { text: '➕ Ще ключ', callback_data: 'catcast_quick_create' },
              ],
              [{ text: '⬅️ До CatCast', callback_data: 'menu_catcast' }],
            ],
          },
        });
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
        const rendered = this.renderCatcastList(keys);
        await this.sendMessage(chatId, rendered.text, {
          parse_mode: 'HTML',
          reply_markup: rendered.markup,
        });
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
            `👤 Назва: <b>${escapeHtml(res.label || '-')}</b>\n` +
            `⏳ На активацію нового пристрою: <b>24 години</b>\n\n` +
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

    // 6. Command handling: /task (Variant A prompt initiation)
    if (textTrimmed === '/task' || textTrimmed.startsWith('/task@')) {
      await this.setAwaitingTask(chatId);
      await this.sendMessage(
        chatId,
        '🎙️ *Записуйте голосове, фото з підписом або пишіть текст задачі...*\n\n_(Очікую ваше повідомлення протягом 5 хвилин)_'
      );
      return { processed: 1, createdTasks: [] };
    }

    // 7. Verification of Variant A: is the user currently awaiting task input?
    const isAwaiting = await this.isAwaitingTask(chatId);
    if (!isAwaiting) {
      await this.sendMessage(
        chatId,
        'ℹ️ Щоб створити задачу, надішліть команду /task або скористайтесь /menu.'
      );
      return { processed: 1, createdTasks: [] };
    }

    // Clear awaiting state since input is now received
    await this.clearAwaitingTask(chatId);

    // 8. Extract attached photo (if present) and upload to Blob
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

    // 9. Extract text or transcribe audio
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

    // 10. Structure task via LLM
    this.logger.log(`Structuring task for ${senderLabel}: "${rawContent.slice(0, 80)}..."`);
    const structured = await this.structureTaskWithLlm(rawContent);

    let finalBody = structured.body;
    if (attachedImageUrl) {
      finalBody += `\n\n### 🖼️ Прикріплене зображення\n![Прикріплене зображення](${attachedImageUrl})`;
    }

    // 11. Create Draft Item on GitHub Project Board #4
    const created = await this.projectBoardService.createDraftItem(structured.title, finalBody);
    createdTasks.push({
      title: structured.title,
      itemId: created.itemId,
      senderId: senderId?.toString() || '',
      username,
      url: created.url,
    });

    // 12. Send confirmation back to user
    const confirmationText =
      `📌 *${structured.title}*\n\n` + `🔗 [Відкрити задачу](${created.url})`;

    await this.sendMessage(chatId, confirmationText);

    return { processed: 1, createdTasks };
  }

  /**
   * Processes inline keyboard button clicks.
   */
  async handleCallbackQuery(
    callbackQuery: TelegramCallbackQuery
  ): Promise<TelegramProcessingResult> {
    const senderId = callbackQuery.from?.id;
    const username = callbackQuery.from?.username;
    const senderLabel = username ? `@${username}` : senderId?.toString() || 'Unknown';
    const chatId = callbackQuery.message?.chat.id;
    const messageId = callbackQuery.message?.message_id;
    const data = callbackQuery.data || '';

    if (!this.isAuthorized(senderId, username)) {
      this.logger.warn(`Unauthorized callback query from ${senderLabel} (ID: ${senderId}).`);
      await this.answerCallbackQuery(callbackQuery.id, '⛔ Немає доступу');
      return { processed: 1, createdTasks: [] };
    }

    if (!chatId || !messageId) {
      await this.answerCallbackQuery(callbackQuery.id);
      return { processed: 1, createdTasks: [] };
    }

    await this.answerCallbackQuery(callbackQuery.id);

    switch (data) {
      case 'menu_main':
        await this.editMessageText(chatId, messageId, this.getMainMenuText(), {
          parse_mode: 'HTML',
          reply_markup: KEYBOARDS.mainMenu,
        });
        break;

      case 'menu_tasks':
        await this.editMessageText(chatId, messageId, this.getTasksMenuText(), {
          parse_mode: 'HTML',
          reply_markup: KEYBOARDS.tasksMenu,
        });
        break;

      case 'action_task_create':
        await this.setAwaitingTask(chatId);
        await this.sendMessage(
          chatId,
          '🎙️ <b>Записуйте голосове, фото з підписом або пишіть текст задачі...</b>\n\n<i>(Очікую ваше повідомлення протягом 5 хвилин)</i>',
          { parse_mode: 'HTML' }
        );
        break;

      case 'action_task_cancel':
        await this.clearAwaitingTask(chatId);
        await this.sendMessage(chatId, '❌ *Створення задачі скасовано.*');
        break;

      case 'menu_catcast':
        await this.editMessageText(chatId, messageId, this.getCatcastMenuText(), {
          parse_mode: 'HTML',
          reply_markup: KEYBOARDS.catcastMenu,
        });
        break;

      case 'catcast_new_menu':
        await this.editMessageText(chatId, messageId, this.getCatcastNewMenuText(), {
          parse_mode: 'HTML',
          reply_markup: KEYBOARDS.catcastNewMenu,
        });
        break;

      case 'catcast_quick_create':
        if (!this.catcastService) {
          await this.sendMessage(chatId, '⚠️ Сервіс CatCast наразі недоступний.');
          break;
        }
        try {
          const created = await this.catcastService.createKey('Швидкий ключ');
          const reply =
            `✅ <b>Ключ CatCast успішно створено!</b>\n\n` +
            `👤 Назва: <b>${escapeHtml(created.label || 'Швидкий ключ')}</b>\n` +
            `🔑 Ключ: <code>${created.key}</code>\n` +
            `⏳ Дійсний для першої активації: <b>24 години</b>\n\n` +
            `<i>(Натисніть на ключ, щоб скопіювати)</i>`;
          await this.sendMessage(chatId, reply, {
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '📋 Список ключів', callback_data: 'catcast_list' },
                  { text: '➕ Ще ключ', callback_data: 'catcast_quick_create' },
                ],
                [{ text: '⬅️ До CatCast', callback_data: 'menu_catcast' }],
              ],
            },
          });
        } catch (err: any) {
          await this.sendMessage(chatId, `❌ Не вдалося створити ключ: ${escapeHtml(err.message)}`, {
            parse_mode: 'HTML',
          });
        }
        break;

      case 'catcast_list':
        if (!this.catcastService) {
          await this.sendMessage(chatId, '⚠️ Сервіс CatCast наразі недоступний.');
          break;
        }
        try {
          const keys = await this.catcastService.listKeys();
          const rendered = this.renderCatcastList(keys);
          await this.editMessageText(chatId, messageId, rendered.text, {
            parse_mode: 'HTML',
            reply_markup: rendered.markup,
          });
        } catch (err: any) {
          await this.sendMessage(
            chatId,
            `❌ Помилка завантаження ключів: ${escapeHtml(err.message)}`,
            {
              parse_mode: 'HTML',
            }
          );
        }
        break;

      case 'catcast_help':
        await this.editMessageText(chatId, messageId, this.getCatcastHelpText(), {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: '⬅️ До меню CatCast', callback_data: 'menu_catcast' }]],
          },
        });
        break;

      case 'menu_help':
        await this.editMessageText(chatId, messageId, this.getGeneralHelpText(), {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: '⬅️ Головне меню', callback_data: 'menu_main' }]],
          },
        });
        break;

      default:
        this.logger.debug(`Unhandled callback query data: ${data}`);
        break;
    }

    return { processed: 1, createdTasks: [] };
  }

  getMainMenuText(): string {
    return (
      `🤖 <b>Головне меню</b>\n\n` +
      `👋 Вітаю в панелі керування! Оберіть розділ:\n\n` +
      `• <b>Задачі (GitHub)</b> — додавання задач голосом або текстом\n` +
      `• <b>Ключі CatCast</b> — керування доступом для додатків`
    );
  }

  getTasksMenuText(): string {
    return (
      `📋 <b>Керування задачами (GitHub)</b>\n\n` +
      `Створюйте задачі на дошці проєкту голосом, текстом або скріншотом.\n\n` +
      `Оберіть дію нижче:`
    );
  }

  getCatcastMenuText(): string {
    return (
      `🐱 <b>Керування ключами CatCast</b>\n\n` +
      `Генерація та адміністрування ключів доступу для додатків CatCast (Android TV, Tizen, Web).\n\n` +
      `• Ключі генеруються без префіксів, рандомні (букви та цифри в нижньому регістрі).\n` +
      `• Перша активація має відбутися протягом <b>24 годин</b> після створення.\n\n` +
      `Оберіть дію нижче:`
    );
  }

  getCatcastNewMenuText(): string {
    return (
      `➕ <b>Створення нового ключа CatCast</b>\n\n` +
      `Ключ генерується без префікса, у нижньому регістрі (тільки цифри та літери).\n` +
      `⏳ <i>Термін на першу активацію: рівно 24 години з моменту створення.</i>\n\n` +
      `<b>Варіанти створення:</b>\n` +
      `• Натисніть <b>⚡ Швидкий ключ</b> нижче\n` +
      `• Або надішліть команду з назвою пристрою:\n` +
      `  <code>/catcast_new [назва]</code>\n` +
      `  <i>(приклад: <code>/catcast_new MiBox Вітальня</code>)</i>`
    );
  }

  getCatcastHelpText(): string {
    return (
      `🐱 <b>Команди CatCast:</b>\n\n` +
      `• <code>/catcast_new [назва]</code> — створити новий ключ\n` +
      `• <code>/catcast_list</code> — список усіх ключів та пристроїв\n` +
      `• <code>/catcast_reset_[ID]</code> — скинути прив'язку пристрою\n` +
      `• <code>/catcast_toggle_[ID]</code> — активувати / заблокувати ключ`
    );
  }

  getGeneralHelpText(): string {
    return (
      `ℹ️ <b>Довідка по боту</b>\n\n` +
      `<b>Доступні команди:</b>\n` +
      `• /menu — Головне меню з інтерактивними кнопками\n` +
      `• /task — Створити задачу на дошці\n` +
      `• /cancel — Скасувати дію\n` +
      `• /catcast — Меню ключів CatCast\n` +
      `• /catcast_new [назва] — Створити ключ\n` +
      `• /catcast_list — Список ключів`
    );
  }

  renderCatcastList(keys: any[]): { text: string; markup: TelegramInlineKeyboardMarkup } {
    if (keys.length === 0) {
      return {
        text: 'ℹ️ <b>Список ключів CatCast порожній.</b>\n\nСтворіть перший ключ через кнопку нижче або командою <code>/catcast_new [назва]</code>.',
        markup: {
          inline_keyboard: [
            [{ text: '➕ Створити ключ', callback_data: 'catcast_new_menu' }],
            [{ text: '⬅️ До CatCast', callback_data: 'menu_catcast' }],
          ],
        },
      };
    }

    const now = Date.now();
    const items = keys.map((k, idx) => {
      const statusIcon = k.isActive ? '🟢' : '🔴';
      const safeLabel = escapeHtml(k.label || 'Без назви');

      let deviceText: string;
      if (k.boundDeviceId) {
        deviceText = `📱 <code>${escapeHtml(k.boundDeviceId.slice(0, 18))}...</code> (${escapeHtml(k.platform || 'web')})`;
      } else {
        const elapsed = now - new Date(k.createdAt).getTime();
        const remainingMs = 24 * 60 * 60 * 1000 - elapsed;
        if (remainingMs > 0 && k.isActive) {
          const hours = Math.floor(remainingMs / (1000 * 60 * 60));
          const mins = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
          deviceText = `⏳ <i>Очікує прив'язки (ще ${hours}г ${mins}хв)</i>`;
        } else if (!k.isActive) {
          deviceText = `🔴 <i>Ключ вимкнено</i>`;
        } else {
          deviceText = `⚠️ <i>Термін активації минув (>24г)</i>`;
        }
      }

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

    return {
      text: `📋 <b>Ключі доступу CatCast (${keys.length}):</b>\n\n` + items.join('\n\n'),
      markup: {
        inline_keyboard: [
          [
            { text: '🔄 Оновити список', callback_data: 'catcast_list' },
            { text: '➕ Новий ключ', callback_data: 'catcast_new_menu' },
          ],
          [{ text: '⬅️ Назад до CatCast', callback_data: 'menu_catcast' }],
        ],
      },
    };
  }

  /**
   * Formats raw dictation into a structured task specification using LLM.
   */
  async structureTaskWithLlm(dictation: string): Promise<StructuredTaskResult> {
    const systemPrompt = `You are an attentive assistant that captures thoughts, ideas, and tasks from spoken voice notes or text dictation.
Your goal is to clearly record and structure the author's thoughts WITHOUT losing their core idea and WITHOUT over-engineering.

CRITICAL RULES:
1. LANGUAGE: Keep EVERYTHING in the EXACT SAME LANGUAGE as the user's dictation (e.g. if Ukrainian, output title and body in Ukrainian; if English, in English). Never translate to another language.
2. TITLE: A concise, highly informative title in Conventional Commits format (e.g. "feat(auth): add Google OAuth", "fix(api): handle null in price parser", "docs: update deployment instructions"). Max 70 characters.
3. BODY: Format the task body using clean GitHub Flavored Markdown with the following structure:
   - ## Огляд / Overview: 1-3 sentences stating what needs to be done and why.
   - ## Завдання / Objectives: bulleted list of clear, actionable checklist items (- [ ] ...).
   - ## Контекст / Details: any technical details, services mentioned, constraints, URLs, or background context.
   Do not add unnecessary boilerplate or fabricated details not mentioned by the author.

RESPONSE FORMAT:
You MUST output ONLY a valid JSON object matching this structure:
{
  "title": "conventional commit title",
  "body": "formatted markdown body"
}`;

    const userPrompt = `Here is the user's raw dictation to structure into a task:\n\n"${dictation}"`;

    try {
      const parsed = await this.llmService.callAndParseJSON<StructuredTaskResult>(
        systemPrompt,
        userPrompt,
        { temperature: 0.2 }
      );

      if (parsed?.title && parsed?.body) {
        return parsed;
      }
    } catch (err: any) {
      this.logger.warn(`Failed to structure task with LLM: ${err.message}. Using fallback formatting.`);
    }

    // Fallback: simple line split if LLM fails
    const lines = dictation.trim().split('\n').filter(Boolean);
    const firstLine = lines[0] || 'Нова задача';
    const rest = lines.slice(1).join('\n') || dictation;

    return {
      title: firstLine.length > 70 ? firstLine.slice(0, 67) + '...' : firstLine,
      body: `## Опис\n\n${rest}`,
    };
  }

  private getBotToken(): string | undefined {
    return (
      this.configService.get<string>('BOARD_TELEGRAM_BOT_TOKEN') ||
      this.configService.get<string>('TELEGRAM_BOT_TOKEN')
    );
  }

  /**
   * Downloads a file from Telegram by its fileId and returns its Buffer.
   */
  async downloadFile(fileId: string): Promise<Buffer> {
    const token = this.getBotToken();
    if (!token) {
      throw new Error('Telegram bot token not configured');
    }

    const infoUrl = `https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`;
    const infoRes = await fetch(infoUrl);
    if (!infoRes.ok) {
      throw new Error(`Failed to get file metadata from Telegram (HTTP ${infoRes.status})`);
    }

    const infoData = (await infoRes.json()) as TelegramFileResponse;
    const filePath = infoData.result?.file_path;
    if (!filePath) {
      throw new Error('Telegram getFile response did not contain file_path');
    }

    const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) {
      throw new Error(`Failed to download audio from Telegram CDN (HTTP ${fileRes.status})`);
    }

    const arrayBuffer = await fileRes.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Answers a callback query from an inline keyboard.
   */
  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    const token = this.getBotToken();
    if (!token) return;

    try {
      await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: callbackQueryId,
          text,
        }),
      });
    } catch (err: any) {
      this.logger.warn(`Failed to answer callback query: ${err.message}`);
    }
  }

  /**
   * Edits the text of a message previously sent by the bot.
   */
  async editMessageText(
    chatId: number | string,
    messageId: number,
    text: string,
    options: {
      parse_mode?: string;
      reply_markup?: TelegramInlineKeyboardMarkup;
    } = { parse_mode: 'HTML' }
  ): Promise<void> {
    const token = this.getBotToken();
    if (!token) return;

    const url = `https://api.telegram.org/bot${token}/editMessageText`;

    try {
      const payload: Record<string, any> = {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: options.parse_mode,
      };
      if (options.reply_markup) {
        payload.reply_markup = options.reply_markup;
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.text();
        this.logger.warn(`editMessageText failed (HTTP ${res.status}): ${err}`);
      }
    } catch (err: any) {
      this.logger.warn(`Error editing Telegram message: ${err.message}`);
    }
  }

  /**
   * Sends a message to a Telegram chat using Telegram Bot API.
   */
  async sendMessage(
    chatId: number | string,
    text: string,
    options: {
      parse_mode?: string;
      reply_markup?: TelegramInlineKeyboardMarkup | TelegramReplyKeyboardMarkup;
    } = { parse_mode: 'Markdown' }
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
      const payload: Record<string, any> = {
        chat_id: chatId,
        text,
        parse_mode: options.parse_mode,
      };
      if (options.reply_markup) {
        payload.reply_markup = options.reply_markup;
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
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
            const fallbackPayload: Record<string, any> = { chat_id: chatId, text };
            if (options.reply_markup) {
              fallbackPayload.reply_markup = options.reply_markup;
            }
            await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(fallbackPayload),
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
