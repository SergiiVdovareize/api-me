import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TelegramService } from './telegram.service';
import { LlmService } from '../llm/llm.service';
import { TranscriptionService } from './services/transcription.service';
import { TelegramProjectBoardService } from './services/telegram-project-board.service';
import { TelegramUpdate } from './interfaces/telegram.interface';

import { RedisReader } from '../common/helpers/redisReader';

describe('TelegramService', () => {
  let service: TelegramService;
  let configService: jest.Mocked<Partial<ConfigService>>;
  let llmService: jest.Mocked<Partial<LlmService>>;
  let transcriptionService: jest.Mocked<Partial<TranscriptionService>>;
  let projectBoardService: jest.Mocked<Partial<TelegramProjectBoardService>>;
  let mockRedisReader: jest.Mocked<Partial<RedisReader>>;

  beforeEach(async () => {
    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'TELEGRAM_BOT_TOKEN') return 'mock_bot_token';
        if (key === 'TELEGRAM_AUTHORIZED_USER_IDS') return '12345,67890';
        if (key === 'TELEGRAM_AUTHORIZED_USERNAMES') return 'admin_user';
        return undefined;
      }),
    };

    mockRedisReader = {
      read: jest.fn().mockResolvedValue(null),
      write: jest.fn().mockResolvedValue('OK'),
      delete: jest.fn().mockResolvedValue(1),
    };

    llmService = {
      callAndParseJSON: jest.fn().mockResolvedValue({
        title: 'feat(core): implement feature',
        body: '## Overview\nTest overview\n\n## Objectives\n- Test item',
      }),
    };

    transcriptionService = {
      transcribeAudio: jest.fn().mockResolvedValue('Dictated voice task content'),
    };

    projectBoardService = {
      createDraftItem: jest.fn().mockResolvedValue({
        itemId: 'PVTI_mock_item_id',
        url: 'https://github.com/users/SergiiVdovareize/projects/4?pane=issue&itemId=123456',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelegramService,
        { provide: ConfigService, useValue: configService },
        { provide: LlmService, useValue: llmService },
        { provide: TranscriptionService, useValue: transcriptionService },
        { provide: TelegramProjectBoardService, useValue: projectBoardService },
        { provide: RedisReader, useValue: mockRedisReader },
      ],
    }).compile();

    service = module.get<TelegramService>(TelegramService);

    // Mock fetch for sendMessage, getFile, and downloadFile
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ ok: true, result: {} }),
      text: jest.fn().mockResolvedValue('ok'),
      arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
    } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('isAuthorized', () => {
    it('should authorize user matching ID in whitelist', () => {
      expect(service.isAuthorized(12345, 'other_username')).toBe(true);
      expect(service.isAuthorized(67890)).toBe(true);
    });

    it('should authorize user matching username in whitelist', () => {
      expect(service.isAuthorized(99999, 'admin_user')).toBe(true);
      expect(service.isAuthorized(99999, '@admin_user')).toBe(true);
    });

    it('should reject unauthorized user', () => {
      expect(service.isAuthorized(99999, 'random_person')).toBe(false);
    });

    it('should authorize user matching BOARD_TELEGRAM_AUTHORIZED_USERNAMES', () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'BOARD_TELEGRAM_AUTHORIZED_USERNAMES') return 'board_owner';
        return undefined;
      });
      expect(service.isAuthorized(88888, 'board_owner')).toBe(true);
    });
  });

  describe('handleIncomingUpdate', () => {
    it('should reject and reply with access denied for unauthorized user', async () => {
      const update: TelegramUpdate = {
        update_id: 1,
        message: {
          message_id: 1,
          date: 1720000000,
          chat: { id: 99999, type: 'private' },
          from: { id: 99999, is_bot: false, first_name: 'Hacker', username: 'intruder' },
          text: 'make a task',
        },
      };

      const result = await service.handleIncomingUpdate(update);
      expect(result.processed).toBe(1);
      expect(result.createdTasks).toHaveLength(0);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({
          body: expect.stringContaining('Access Denied'),
        })
      );
    });

    it('should answer /start or /help with welcome message', async () => {
      const update: TelegramUpdate = {
        update_id: 2,
        message: {
          message_id: 2,
          date: 1720000000,
          chat: { id: 12345, type: 'private' },
          from: { id: 12345, is_bot: false, first_name: 'Sergii', username: 'admin_user' },
          text: '/start',
        },
      };

      const result = await service.handleIncomingUpdate(update);
      expect(result.processed).toBe(1);
      expect(result.createdTasks).toHaveLength(0);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({
          body: expect.stringContaining('AI Tasks Bot'),
        })
      );
    });

    it('should prompt user when /task command is received', async () => {
      const update: TelegramUpdate = {
        update_id: 21,
        message: {
          message_id: 21,
          date: 1720000000,
          chat: { id: 12345, type: 'private' },
          from: { id: 12345, is_bot: false, first_name: 'Sergii', username: 'admin_user' },
          text: '/task',
        },
      };

      const result = await service.handleIncomingUpdate(update);
      expect(result.processed).toBe(1);
      expect(result.createdTasks).toHaveLength(0);
      expect(await service.isAwaitingTask(12345)).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({
          body: expect.stringContaining('Записуйте голосове або пишіть текст задачі'),
        })
      );
    });

    it('should cancel awaiting state when /cancel is received', async () => {
      await service.setAwaitingTask(12345);
      expect(await service.isAwaitingTask(12345)).toBe(true);

      const update: TelegramUpdate = {
        update_id: 22,
        message: {
          message_id: 22,
          date: 1720000000,
          chat: { id: 12345, type: 'private' },
          from: { id: 12345, is_bot: false, first_name: 'Sergii' },
          text: '/cancel',
        },
      };

      const result = await service.handleIncomingUpdate(update);
      expect(result.processed).toBe(1);
      expect(await service.isAwaitingTask(12345)).toBe(false);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({
          body: expect.stringContaining('Створення задачі скасовано'),
        })
      );
    });

    it('should prompt to use /task if message is sent without prior /task invocation', async () => {
      const update: TelegramUpdate = {
        update_id: 23,
        message: {
          message_id: 23,
          date: 1720000000,
          chat: { id: 12345, type: 'private' },
          from: { id: 12345, is_bot: false, first_name: 'Sergii' },
          text: 'Random message without /task',
        },
      };

      const result = await service.handleIncomingUpdate(update);
      expect(result.processed).toBe(1);
      expect(result.createdTasks).toHaveLength(0);
      expect(projectBoardService.createDraftItem).not.toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({
          body: expect.stringContaining('спочатку виберіть команду /task у меню'),
        })
      );
    });

    it('should process text task and reply with only title and direct task link after /task', async () => {
      await service.setAwaitingTask(12345);

      const update: TelegramUpdate = {
        update_id: 3,
        message: {
          message_id: 3,
          date: 1720000000,
          chat: { id: 12345, type: 'private' },
          from: { id: 12345, is_bot: false, first_name: 'Sergii' },
          text: 'Add dark mode to navigation header',
        },
      };

      const result = await service.handleIncomingUpdate(update);
      expect(result.processed).toBe(1);
      expect(result.createdTasks).toHaveLength(1);
      expect(result.createdTasks[0].title).toBe('feat(core): implement feature');
      expect(projectBoardService.createDraftItem).toHaveBeenCalledWith(
        'feat(core): implement feature',
        expect.any(String)
      );

      // Verify concise confirmation message: title and direct task link
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({
          body: expect.stringContaining('feat(core): implement feature'),
        })
      );
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({
          body: expect.stringContaining('https://github.com/users/SergiiVdovareize/projects/4?pane=issue&itemId=123456'),
        })
      );
      // Ensure description is omitted
      expect(global.fetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({
          body: expect.stringContaining('📋 *Description:*'),
        })
      );
    });

    it('should process voice memo, transcribe, structure, and create draft item after /task', async () => {
      await service.setAwaitingTask(12345);

      // Mock getFile and download
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            ok: true,
            result: { file_path: 'voice/file_123.oga' },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(16)),
        })
        // sendMessage confirmation
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ ok: true }),
        });

      const update: TelegramUpdate = {
        update_id: 4,
        message: {
          message_id: 4,
          date: 1720000000,
          chat: { id: 12345, type: 'private' },
          from: { id: 12345, is_bot: false, first_name: 'Sergii' },
          voice: {
            file_id: 'voice_file_id_999',
            file_unique_id: 'unique_999',
            duration: 12,
            mime_type: 'audio/ogg',
          },
        },
      };

      const result = await service.handleIncomingUpdate(update);
      expect(result.processed).toBe(1);
      expect(transcriptionService.transcribeAudio).toHaveBeenCalled();
      expect(llmService.callAndParseJSON).toHaveBeenCalled();
      expect(projectBoardService.createDraftItem).toHaveBeenCalled();
      expect(result.createdTasks).toHaveLength(1);
    });

    it('should return 0 processed tasks when update has no message', async () => {
      const result = await service.handleIncomingUpdate({ update_id: 100 });
      expect(result.processed).toBe(0);
      expect(result.createdTasks).toHaveLength(0);
    });

    it('should process edited_message', async () => {
      await service.setAwaitingTask(12345);
      const update: TelegramUpdate = {
        update_id: 101,
        edited_message: {
          message_id: 5,
          date: 1720000000,
          chat: { id: 12345, type: 'private' },
          from: { id: 12345, is_bot: false, first_name: 'Sergii' },
          text: 'Edited task text',
        },
      };

      const result = await service.handleIncomingUpdate(update);
      expect(result.processed).toBe(1);
      expect(result.createdTasks).toHaveLength(1);
    });

    it('should support /task@botname command syntax', async () => {
      const update: TelegramUpdate = {
        update_id: 102,
        message: {
          message_id: 6,
          date: 1720000000,
          chat: { id: 12345, type: 'private' },
          from: { id: 12345, is_bot: false, first_name: 'Sergii' },
          text: '/task@my_tasks_bot',
        },
      };

      const result = await service.handleIncomingUpdate(update);
      expect(result.processed).toBe(1);
      expect(await service.isAwaitingTask(12345)).toBe(true);
    });

    it('should warn when text or voice content is empty', async () => {
      await service.setAwaitingTask(12345);
      const update: TelegramUpdate = {
        update_id: 103,
        message: {
          message_id: 7,
          date: 1720000000,
          chat: { id: 12345, type: 'private' },
          from: { id: 12345, is_bot: false, first_name: 'Sergii' },
          text: '',
        },
      };

      const result = await service.handleIncomingUpdate(update);
      expect(result.processed).toBe(1);
      expect(result.createdTasks).toHaveLength(0);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({
          body: expect.stringContaining('Не вдалося розпізнати текст'),
        })
      );
    });

    it('should process audio message (message.audio)', async () => {
      await service.setAwaitingTask(12345);

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({
            ok: true,
            result: { file_path: 'audio/music.mp3' },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(16)),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ ok: true }),
        });

      const update: TelegramUpdate = {
        update_id: 104,
        message: {
          message_id: 8,
          date: 1720000000,
          chat: { id: 12345, type: 'private' },
          from: { id: 12345, is_bot: false, first_name: 'Sergii' },
          audio: {
            file_id: 'audio_file_123',
            file_unique_id: 'u_123',
            duration: 5,
            mime_type: 'audio/mp3',
          },
        },
      };

      const result = await service.handleIncomingUpdate(update);
      expect(result.processed).toBe(1);
      expect(transcriptionService.transcribeAudio).toHaveBeenCalledWith(expect.any(Buffer), 'audio/mp3');
    });

    it('should fallback to firstLine formatting when structureTaskWithLlm throws', async () => {
      llmService.callAndParseJSON!.mockRejectedValueOnce(new Error('AI parsing failed'));
      const fallback = await service.structureTaskWithLlm('Fix navigation bar\nDetailed bug report here');
      expect(fallback.title).toBe('Fix navigation bar');
      expect(fallback.body).toContain('Fix navigation bar');
    });

    it('should read from redisReader in isAwaitingTask when memory is empty', async () => {
      mockRedisReader.read!.mockResolvedValueOnce('1');
      const isAwaiting = await service.isAwaitingTask(98765);
      expect(isAwaiting).toBe(true);
      expect(mockRedisReader.read).toHaveBeenCalledWith('telegram:awaiting_task:98765');
    });

    it('should register bot commands and handle errors gracefully', async () => {
      await service.onModuleInit();
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/setMyCommands'),
        expect.any(Object)
      );

      // Handle fetch rejection
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));
      await expect(service.registerBotCommands()).resolves.not.toThrow();
    });

    it('should handle downloadFile failure branches', async () => {
      // 1. Missing bot token
      (configService.get as jest.Mock).mockReturnValue(undefined);
      const mockBuf = await service.downloadFile('file_1');
      expect(mockBuf.toString()).toBe('mock-audio-buffer');

      // Restore token
      (configService.get as jest.Mock).mockReturnValue('mock_bot_token');

      // 2. getFile non-ok response
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: jest.fn().mockResolvedValue('Not found'),
      });
      await expect(service.downloadFile('file_1')).rejects.toThrow('Telegram getFile failed: HTTP 404');

      // 3. getFile response missing file_path
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ ok: true, result: {} }),
      });
      await expect(service.downloadFile('file_1')).rejects.toThrow('did not contain file_path');

      // 4. CDN download failure
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ ok: true, result: { file_path: 'a/b.oga' } }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
        });
      await expect(service.downloadFile('file_1')).rejects.toThrow('Failed to download audio from Telegram CDN');
    });

    it('should handle sendMessage failure branches', async () => {
      // 1. Missing bot token
      (configService.get as jest.Mock).mockReturnValue(undefined);
      await expect(service.sendMessage(12345, 'text')).resolves.not.toThrow();

      // Restore token
      (configService.get as jest.Mock).mockReturnValue('mock_bot_token');

      // 2. HTTP non-ok response
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: jest.fn().mockResolvedValue('Chat not found'),
      });
      await expect(service.sendMessage(12345, 'text')).resolves.not.toThrow();

      // 3. Fetch error
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Fetch network error'));
      await expect(service.sendMessage(12345, 'text')).resolves.not.toThrow();
    });
  });
});
