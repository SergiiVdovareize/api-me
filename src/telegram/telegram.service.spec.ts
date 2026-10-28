import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TelegramService } from './telegram.service';
import { LlmService } from '../llm/llm.service';
import { TranscriptionService } from './services/transcription.service';
import { TelegramProjectBoardService } from './services/telegram-project-board.service';
import { TelegramUpdate } from './interfaces/telegram.interface';

describe('TelegramService', () => {
  let service: TelegramService;
  let configService: jest.Mocked<Partial<ConfigService>>;
  let llmService: jest.Mocked<Partial<LlmService>>;
  let transcriptionService: jest.Mocked<Partial<TranscriptionService>>;
  let projectBoardService: jest.Mocked<Partial<TelegramProjectBoardService>>;

  beforeEach(async () => {
    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'TELEGRAM_BOT_TOKEN') return 'mock_bot_token';
        if (key === 'TELEGRAM_AUTHORIZED_USER_IDS') return '12345,67890';
        if (key === 'TELEGRAM_AUTHORIZED_USERNAMES') return 'admin_user';
        return undefined;
      }),
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
      createDraftItem: jest.fn().mockResolvedValue('PVTI_mock_item_id'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelegramService,
        { provide: ConfigService, useValue: configService },
        { provide: LlmService, useValue: llmService },
        { provide: TranscriptionService, useValue: transcriptionService },
        { provide: TelegramProjectBoardService, useValue: projectBoardService },
      ],
    }).compile();

    service = module.get<TelegramService>(TelegramService);

    // Mock fetch for sendMessage and downloadFile
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
          body: expect.stringContaining('Welcome to AI Tasks Bot'),
        })
      );
    });

    it('should process text task and add to project board', async () => {
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
    });

    it('should process voice memo, transcribe, structure, and create draft item', async () => {
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
        // sendMessage "Processing..."
        .mockResolvedValueOnce({
          ok: true,
          json: jest.fn().mockResolvedValue({ ok: true }),
        })
        // sendMessage "Task added..."
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
  });
});
