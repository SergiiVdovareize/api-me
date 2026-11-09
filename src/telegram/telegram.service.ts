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
  TelegramInlineKeyboardButton,
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
        { text: '🐱 Доступ CatCast', callback_data: 'menu_catcast' },
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
      [{ text: '📱 Дозволені пристрої', callback_data: 'catcast_devices_list' }],
      [{ text: 'ℹ️ Довідка по командах', callback_data: 'catcast_help' }],
      [{ text: '⬅️ Головне меню', callback_data: 'menu_main' }],
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
    if (this.catcastService) {
      this.catcastService.setDeviceRequestNotifier(async request => {
        return this.notifyNewDeviceRequest(request);
      });
    }
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
            { command: 'catcast', description: '🐱 Доступ CatCast' },
            { command: 'catcast_devices', description: '📱 Дозволені пристрої' },
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
        `• /catcast — керування доступом пристроїв\n` +
        `• /catcast_devices — список дозволених пристроїв\n` +
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

    // 5. CatCast Device Access commands
    if (textTrimmed === '/catcast' || textTrimmed.startsWith('/catcast_help')) {
      await this.sendMessage(chatId, this.getCatcastMenuText(), {
        parse_mode: 'HTML',
        reply_markup: KEYBOARDS.catcastMenu,
      });
      return { processed: 1, createdTasks: [] };
    }

    if (textTrimmed === '/catcast_devices' || textTrimmed.startsWith('/catcast_devices@')) {
      if (!this.catcastService) {
        await this.sendMessage(chatId, '⚠️ Сервіс CatCast наразі недоступний.');
        return { processed: 1, createdTasks: [] };
      }

      try {
        const devices = await this.catcastService.listAllowedDevices();
        const rendered = this.renderCatcastDeviceList(devices);
        await this.sendMessage(chatId, rendered.text, {
          parse_mode: 'HTML',
          reply_markup: rendered.markup,
        });
      } catch (err: any) {
        await this.sendMessage(
          chatId,
          `❌ Помилка завантаження дозволених пристроїв: ${escapeHtml(err.message)}`,
          { parse_mode: 'HTML' }
        );
      }
      return { processed: 1, createdTasks: [] };
    }

    if (textTrimmed.startsWith('/catcast_revoke')) {
      if (!this.catcastService) {
        await this.sendMessage(chatId, '⚠️ Сервіс CatCast наразі недоступний.');
        return { processed: 1, createdTasks: [] };
      }

      const idOrDevice = textTrimmed
        .replace(/^\/catcast_revoke_(@\w+)?/i, '')
        .replace(/^\/catcast_revoke(@\w+)?/i, '')
        .replace(/^_/, '')
        .trim();

      if (!idOrDevice) {
        await this.sendMessage(
          chatId,
          'ℹ️ Вкажіть ID або Device ID для відкликання: <code>/catcast_revoke_[ID]</code>',
          { parse_mode: 'HTML' }
        );
        return { processed: 1, createdTasks: [] };
      }

      try {
        const res = await this.catcastService.revokeDeviceAccess(idOrDevice);
        await this.sendMessage(
          chatId,
          `🚫 <b>Доступ для пристрою відкликано!</b>\n\n` +
            `📱 <b>${escapeHtml(res.model || res.deviceId)}</b>\n` +
            `🔑 Device ID: <code>${res.deviceId}</code>\n\n` +
            `Цей пристрій більше не має доступу без ключа.`,
          { parse_mode: 'HTML' }
        );
      } catch (err: any) {
        await this.sendMessage(
          chatId,
          `❌ Не вдалося відкликати доступ: ${escapeHtml(err.message)}`,
          { parse_mode: 'HTML' }
        );
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
        'ℹ️ Щоб створити задачу, спочатку виберіть команду /task у меню або скористайтесь /menu.'
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

    if (data.startsWith('catcast_dev_approve:')) {
      const requestId = data.replace('catcast_dev_approve:', '').trim();
      const adminName = username ? `@${username}` : callbackQuery.from?.first_name || 'Адмін';

      if (!this.catcastService) {
        await this.answerCallbackQuery(callbackQuery.id, '⚠️ CatCast недоступний');
        return { processed: 1, createdTasks: [] };
      }

      try {
        const res = await this.catcastService.approveDeviceRequest(requestId, adminName);
        if (res.alreadyProcessed) {
          await this.answerCallbackQuery(callbackQuery.id, 'ℹ️ Заявку вже було оброблено');
        } else {
          await this.answerCallbackQuery(callbackQuery.id, '✅ Доступ надано');
        }

        const nowStr = new Date().toLocaleTimeString('uk-UA', {
          timeZone: 'Europe/Kyiv',
          hour: '2-digit',
          minute: '2-digit',
        });
        const currentText = callbackQuery.message?.text || '';
        const updatedText = `${currentText}\n\n✅ <b>Дозволено:</b> ${escapeHtml(adminName)} (${nowStr})`;
        await this.editMessageText(chatId, messageId, updatedText, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [] },
        });
      } catch (err: any) {
        await this.answerCallbackQuery(callbackQuery.id, `❌ Помилка: ${err.message}`);
      }
      return { processed: 1, createdTasks: [] };
    }

    if (data.startsWith('catcast_dev_deny:')) {
      const requestId = data.replace('catcast_dev_deny:', '').trim();
      const adminName = username ? `@${username}` : callbackQuery.from?.first_name || 'Адмін';

      if (!this.catcastService) {
        await this.answerCallbackQuery(callbackQuery.id, '⚠️ CatCast недоступний');
        return { processed: 1, createdTasks: [] };
      }

      try {
        const res = await this.catcastService.denyDeviceRequest(requestId, adminName);
        if (res.alreadyProcessed) {
          await this.answerCallbackQuery(callbackQuery.id, 'ℹ️ Заявку вже було оброблено');
        } else {
          await this.answerCallbackQuery(callbackQuery.id, '❌ Заявку відхилено');
        }

        const nowStr = new Date().toLocaleTimeString('uk-UA', {
          timeZone: 'Europe/Kyiv',
          hour: '2-digit',
          minute: '2-digit',
        });
        const currentText = callbackQuery.message?.text || '';
        const updatedText = `${currentText}\n\n❌ <b>Відхилено:</b> ${escapeHtml(adminName)} (${nowStr})`;
        await this.editMessageText(chatId, messageId, updatedText, {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [] },
        });
      } catch (err: any) {
        await this.answerCallbackQuery(callbackQuery.id, `❌ Помилка: ${err.message}`);
      }
      return { processed: 1, createdTasks: [] };
    }

    if (data.startsWith('catcast_dev_revoke:')) {
      const idOrDevice = data.replace('catcast_dev_revoke:', '').trim();
      if (!this.catcastService) {
        await this.answerCallbackQuery(callbackQuery.id, '⚠️ CatCast недоступний');
        return { processed: 1, createdTasks: [] };
      }

      try {
        await this.catcastService.revokeDeviceAccess(idOrDevice);
        await this.answerCallbackQuery(callbackQuery.id, '🚫 Доступ відкликано');
        const devices = await this.catcastService.listAllowedDevices();
        const rendered = this.renderCatcastDeviceList(devices);
        await this.editMessageText(chatId, messageId, rendered.text, {
          parse_mode: 'HTML',
          reply_markup: rendered.markup,
        });
      } catch (err: any) {
        await this.answerCallbackQuery(callbackQuery.id, `❌ Помилка: ${err.message}`);
      }
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

      case 'catcast_devices_list':
        if (!this.catcastService) {
          await this.sendMessage(chatId, '⚠️ Сервіс CatCast наразі недоступний.');
          break;
        }
        try {
          const devices = await this.catcastService.listAllowedDevices();
          const rendered = this.renderCatcastDeviceList(devices);
          await this.editMessageText(chatId, messageId, rendered.text, {
            parse_mode: 'HTML',
            reply_markup: rendered.markup,
          });
        } catch (err: any) {
          await this.sendMessage(
            chatId,
            `❌ Помилка завантаження дозволених пристроїв: ${escapeHtml(err.message)}`,
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
      `🐱 <b>Управління доступом CatCast</b>\n\n` +
      `Адміністрування доступу пристроїв (Android TV, Tizen, Web) за Device ID.\n\n` +
      `• Нові пристрої надсилають запит на підтвердження при спробі входу.\n` +
      `• Підтвердження або відхилення здійснюється кнопками в цьому чаті.\n\n` +
      `Оберіть дію нижче:`
    );
  }

  getCatcastHelpText(): string {
    return (
      `🐱 <b>Команди доступу CatCast:</b>\n\n` +
      `• <code>/catcast_devices</code> — список дозволених пристроїв\n` +
      `• <code>/catcast_revoke_[ID]</code> — відкликати доступ пристрою`
    );
  }

  getGeneralHelpText(): string {
    return (
      `ℹ️ <b>Довідка по боту</b>\n\n` +
      `<b>Доступні команди:</b>\n` +
      `• /menu — Головне меню з інтерактивними кнопками\n` +
      `• /task — Створити задачу на дошці\n` +
      `• /cancel — Скасувати дію\n` +
      `• /catcast — Меню доступу CatCast\n` +
      `• /catcast_devices — Список дозволених пристроїв\n` +
      `• /catcast_revoke_[ID] — Відкликати доступ`
    );
  }

  /**
   * Renders a list of allowed CatCast devices with revocation buttons.
   */
  renderCatcastDeviceList(devices: any[]): {
    text: string;
    markup: TelegramInlineKeyboardMarkup;
  } {
    if (!devices || devices.length === 0) {
      return {
        text: '📱 <b>Дозволені пристрої CatCast</b>\n\nНаразі немає жодного дозволеного пристрою.',
        markup: {
          inline_keyboard: [[{ text: '⬅️ До CatCast', callback_data: 'menu_catcast' }]],
        },
      };
    }

    let text = `📱 <b>Дозволені пристрої CatCast (${devices.length})</b>\n\n`;
    const keyboardRows: TelegramInlineKeyboardButton[][] = [];

    devices.forEach((dev, idx) => {
      const model = escapeHtml(dev.model || 'Пристрій');
      const platform = escapeHtml(dev.platform);
      const devId = dev.deviceId || '';
      const deviceIdShort = escapeHtml(devId.length > 22 ? devId.slice(0, 20) + '...' : devId);
      text += `<b>${idx + 1}. ${model}</b> (${platform})\n`;
      text += `   <code>${deviceIdShort}</code>\n`;
      text += `   <i>Схвалено: ${new Date(dev.createdAt).toLocaleDateString('uk-UA')}</i>\n\n`;

      keyboardRows.push([
        {
          text: `🚫 Відкликати #${dev.id}`,
          callback_data: `catcast_dev_revoke:${dev.id}`,
        },
      ]);
    });

    keyboardRows.push([{ text: '⬅️ До CatCast', callback_data: 'menu_catcast' }]);

    return {
      text,
      markup: { inline_keyboard: keyboardRows },
    };
  }

  /**
   * Sends a notification to the admin chat about a new pending device request.
   */
  async notifyNewDeviceRequest(request: {
    id: string;
    deviceId: string;
    platform: string;
    model?: string | null;
    os?: string | null;
    code?: string | null;
    createdAt: Date;
  }): Promise<{ messageId?: number; chatId?: string } | void> {
    const adminChatId =
      this.configService.get<string>('CATCAST_ADMIN_CHAT_ID')?.trim() ||
      this.configService.get<string>('TELEGRAM_DEFAULT_CHAT_ID')?.trim() ||
      '1252877';

    const createdTimeStr = new Date(request.createdAt).toLocaleString('uk-UA', {
      timeZone: 'Europe/Kyiv',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const codeHeader = request.code
      ? `🔑 <b>Код: ${escapeHtml(request.code)}</b>\n\n`
      : '';

    const text =
      `${codeHeader}` +
      `📺 <b>Нова заявка на доступ до CatCast</b>\n` +
      `📱 <b>Пристрій:</b> <code>${escapeHtml(request.model || 'Невідомий')}</code>\n` +
      `💻 <b>ОС:</b> <code>${escapeHtml(request.os || '-')}</code>\n` +
      `🌐 <b>Платформа:</b> <code>${escapeHtml(request.platform)}</code>\n` +
      `🔑 <b>Device ID:</b> <code>${escapeHtml(request.deviceId)}</code>\n` +
      `⏱ <b>Час:</b> ${createdTimeStr} <i>(діє 30 хв)</i>`;

    const keyboard: TelegramInlineKeyboardMarkup = {
      inline_keyboard: [
        [
          { text: '✅ Дозволити', callback_data: `catcast_dev_approve:${request.id}` },
          { text: '❌ Відхилити', callback_data: `catcast_dev_deny:${request.id}` },
        ],
      ],
    };

    const sent = await this.sendMessage(adminChatId, text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });

    if (sent && sent.messageId) {
      return {
        messageId: sent.messageId,
        chatId: sent.chatId ? String(sent.chatId) : adminChatId,
      };
    }
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
      this.logger.warn(
        `Failed to structure task with LLM: ${err.message}. Using fallback formatting.`
      );
    }

    // Fallback: simple line split if LLM fails
    const firstLine = dictation.split('\n')[0].trim().slice(0, 80);
    return {
      title: firstLine || 'Нова задача',
      body: `## Суть ідеї\n${dictation}\n\n---\n*Task dictated via Telegram bot.*`,
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
      this.logger.warn('TELEGRAM_BOT_TOKEN not configured. Returning mock audio buffer.');
      return Buffer.from('mock-audio-buffer');
    }

    // 1. Get file path from Telegram
    const getFileUrl = `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`;
    const infoRes = await fetch(getFileUrl);
    if (!infoRes.ok) {
      const err = await infoRes.text();
      this.logger.error(
        `Failed to get file metadata from Telegram (HTTP ${infoRes.status}): ${err}`
      );
      throw new Error(`Telegram getFile failed: HTTP ${infoRes.status}`);
    }

    const infoData = (await infoRes.json()) as TelegramFileResponse;
    const filePath = infoData.result?.file_path;
    if (!filePath) {
      throw new Error(`Telegram getFile response did not contain file_path for file ID ${fileId}`);
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
  ): Promise<{ messageId?: number; chatId?: string | number } | void> {
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
        try {
          const data = (await res.json()) as any;
          return {
            messageId: data?.result?.message_id,
            chatId: data?.result?.chat?.id,
          };
        } catch {
          // ignore json parse error
        }
      }
    } catch (err: any) {
      this.logger.error(`Error sending Telegram message: ${err.message}`);
    }
  }
}
