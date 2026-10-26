import { ConfigService } from '@nestjs/config';
import { TelegramService } from './telegram.service';

describe('TelegramService', () => {
  let service: TelegramService;
  let configService: jest.Mocked<ConfigService>;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();

    configService = {
      get: jest.fn((key: string) => {
        if (key === 'TELEGRAM_BOT_TOKEN') return '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';
        if (key === 'TELEGRAM_DEFAULT_CHAT_ID') return '987654';
        return undefined;
      }),
    } as any;

    service = new TelegramService(configService);
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe('getBotToken', () => {
    it('should return configured token', () => {
      expect(service.getBotToken()).toBe('123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11');
    });

    it('should throw if token is not configured', () => {
      configService.get.mockReturnValue(undefined);
      expect(() => service.getBotToken()).toThrow('TELEGRAM_BOT_TOKEN is not configured');
    });
  });

  describe('getDefaultChatId', () => {
    it('should return configured chat id', () => {
      expect(service.getDefaultChatId()).toBe('987654');
    });

    it('should fallback to default chat id if not configured', () => {
      configService.get.mockReturnValue(undefined);
      expect(service.getDefaultChatId()).toBe('1252877');
    });
  });

  describe('splitTextIntoChunks', () => {
    it('should return single chunk if length <= 4000', () => {
      const text = 'Hello world';
      expect(service.splitTextIntoChunks(text)).toEqual(['Hello world']);
    });

    it('should split long text into chunks of at most maxLength', () => {
      const text = 'A'.repeat(8500);
      const chunks = service.splitTextIntoChunks(text, 4000);
      expect(chunks.length).toBe(3);
      expect(chunks[0].length).toBe(4000);
      expect(chunks[1].length).toBe(4000);
      expect(chunks[2].length).toBe(500);
    });
  });

  describe('sendMessage', () => {
    it('should make successful POST request with default chat id', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, result: {} }),
      } as any);

      await service.sendMessage('<b>Test</b>');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.telegram.org/bot123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11/sendMessage',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: '987654',
            text: '<b>Test</b>',
            parse_mode: 'HTML',
            disable_web_page_preview: false,
          }),
        }
      );
    });

    it('should send each chunk for long text', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true }),
      } as any);

      const longText = 'B'.repeat(5000);
      await service.sendMessage(longText, 'custom-chat');

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should throw if HTTP response is not ok', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Bad Request: chat not found',
      } as any);

      await expect(service.sendMessage('Test')).rejects.toThrow(
        'Telegram API responded with status 400: Bad Request: chat not found'
      );
    });

    it('should throw if JSON indicates failure', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: false, description: 'Forbidden: bot was blocked by the user' }),
      } as any);

      await expect(service.sendMessage('Test')).rejects.toThrow(
        'Forbidden: bot was blocked by the user'
      );
    });
  });
});
