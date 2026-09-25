import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LlmService } from './llm.service';
import { LLMProvider } from './interfaces/llm.interface';

describe('LlmService', () => {
  let service: LlmService;
  let mockProvider: jest.Mocked<LLMProvider>;

  beforeEach(async () => {
    mockProvider = {
      call: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<LlmService>(LlmService);
    service.setProvider(mockProvider);
  });

  it('should be defined and hold active provider', () => {
    expect(service).toBeDefined();
    expect(service.getProvider()).toBe(mockProvider);
  });

  describe('call', () => {
    it('should delegate raw call to the active provider', async () => {
      mockProvider.call.mockResolvedValue('Raw LLM completion');

      const res = await service.call('System', 'User');
      expect(res).toBe('Raw LLM completion');
      expect(mockProvider.call).toHaveBeenCalledWith('System', 'User', undefined);
    });
  });

  describe('callAndParseJSON', () => {
    it('should parse clean JSON directly', async () => {
      mockProvider.call.mockResolvedValue('{"ideas": ["Idea 1", "Idea 2"]}');

      const res = await service.callAndParseJSON<{ ideas: string[] }>('System', 'User');
      expect(res).toEqual({ ideas: ['Idea 1', 'Idea 2'] });
    });

    it('should strip markdown code fences and parse JSON', async () => {
      mockProvider.call.mockResolvedValue('```json\n{"status": "ok"}\n```');

      const res = await service.callAndParseJSON<{ status: string }>('System', 'User');
      expect(res).toEqual({ status: 'ok' });
    });

    it('should extract JSON boundaries when wrapped by conversational text', async () => {
      mockProvider.call.mockResolvedValue(
        'Here is the JSON you requested:\n{"letter": "А", "items": [1, 2]}\nHope this helps!'
      );

      const res = await service.callAndParseJSON<{ letter: string; items: number[] }>(
        'System',
        'User'
      );
      expect(res).toEqual({ letter: 'А', items: [1, 2] });
    });

    it('should extract array JSON boundaries properly', async () => {
      mockProvider.call.mockResolvedValue('Prefix note [ {"title": "Test"} ] suffix');

      const res = await service.callAndParseJSON<Array<{ title: string }>>('System', 'User');
      expect(res).toEqual([{ title: 'Test' }]);
    });

    it('should retry with prompt reinforcement if first response is invalid JSON', async () => {
      mockProvider.call
        .mockResolvedValueOnce('Invalid JSON string without brackets')
        .mockResolvedValueOnce('{"recovered": true}');

      const res = await service.callAndParseJSON<{ recovered: boolean }>(
        'Base System',
        'Base User',
        undefined,
        1
      );

      expect(res).toEqual({ recovered: true });
      expect(mockProvider.call).toHaveBeenCalledTimes(2);
      expect(mockProvider.call).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('CRITICAL: Your previous response was not valid JSON'),
        expect.stringContaining('Retry attempt 2'),
        undefined
      );
    });

    it('should throw error when all retries fail to produce valid JSON', async () => {
      mockProvider.call.mockResolvedValue('Still not a valid JSON');

      await expect(service.callAndParseJSON('System', 'User', undefined, 1)).rejects.toThrow(
        'Call to AI failed to return valid JSON after 2 attempts'
      );
    });
  });
});
