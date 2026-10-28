import { TranscriptionService } from './transcription.service';
import { ConfigService } from '@nestjs/config';

describe('TranscriptionService', () => {
  let service: TranscriptionService;
  let configService: ConfigService;
  const originalFetch = global.fetch;

  beforeEach(() => {
    configService = {
      get: jest.fn(),
    } as any;
    service = new TranscriptionService(configService);
    jest.clearAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('should fall back to placeholder when neither GROQ_API_KEY nor OPENAI_API_KEY is configured', async () => {
    (configService.get as jest.Mock).mockReturnValue(undefined);

    const result = await service.transcribeAudio(Buffer.from('fake-audio'));
    expect(result).toContain('Voice memo dictation');
  });

  it('should call Groq Whisper API when GROQ_API_KEY is configured', async () => {
    (configService.get as jest.Mock).mockImplementation((key: string) => {
      if (key === 'GROQ_API_KEY') return 'gsk-test-key';
      return undefined;
    });

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValueOnce({ text: 'Зробити бекап бази даних щодня' }),
    } as any);

    const result = await service.transcribeAudio(Buffer.from('audio-bytes'), 'audio/ogg');
    expect(result).toBe('Зробити бекап бази даних щодня');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer gsk-test-key',
        }),
      })
    );
  });

  it('should call OpenAI Whisper API when only OPENAI_API_KEY is configured', async () => {
    (configService.get as jest.Mock).mockImplementation((key: string) => {
      if (key === 'OPENAI_API_KEY') return 'sk-openai-key';
      return undefined;
    });

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValueOnce({ text: 'Implement auth token refresh' }),
    } as any);

    const result = await service.transcribeAudio(Buffer.from('audio-bytes'), 'audio/m4a');
    expect(result).toBe('Implement auth token refresh');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/audio/transcriptions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-openai-key',
        }),
      })
    );
  });

  it('should throw an error when Whisper API responds with non-ok status', async () => {
    (configService.get as jest.Mock).mockImplementation((key: string) => {
      if (key === 'GROQ_API_KEY') return 'gsk-test-key';
      return undefined;
    });

    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: jest.fn().mockResolvedValueOnce('Invalid API Key'),
    } as any);

    await expect(service.transcribeAudio(Buffer.from('audio-bytes'))).rejects.toThrow(
      'Whisper transcription failed: HTTP 401 Unauthorized'
    );
  });
});
