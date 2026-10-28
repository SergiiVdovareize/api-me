import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TranscriptionService {
  private readonly logger = new Logger(TranscriptionService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Transcribes an audio buffer into text.
   * Prioritizes Groq Whisper (ultra-fast & cost-effective) or OpenAI Whisper API.
   */
  async transcribeAudio(audioBuffer: Buffer, mimeType = 'audio/ogg'): Promise<string> {
    const groqApiKey = this.configService.get<string>('GROQ_API_KEY')?.trim();
    const openaiApiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();

    if (groqApiKey) {
      return this.transcribeWithWhisperApi(
        audioBuffer,
        'https://api.groq.com/openai/v1/audio/transcriptions',
        groqApiKey,
        'whisper-large-v3',
        mimeType
      );
    }

    if (openaiApiKey) {
      return this.transcribeWithWhisperApi(
        audioBuffer,
        'https://api.openai.com/v1/audio/transcriptions',
        openaiApiKey,
        'whisper-1',
        mimeType
      );
    }

    this.logger.warn(
      'Neither GROQ_API_KEY nor OPENAI_API_KEY is configured. Falling back to mock transcription for testing/development.'
    );
    return 'Voice memo dictation (transcription pending API key configuration)';
  }

  private async transcribeWithWhisperApi(
    audioBuffer: Buffer,
    endpoint: string,
    apiKey: string,
    model: string,
    mimeType: string
  ): Promise<string> {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    const filename = mimeType.includes('mp4') || mimeType.includes('m4a') ? 'audio.m4a' : 'audio.ogg';

    // Construct multipart/form-data manually using Buffer to avoid external dependencies
    const preamble = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`
    );
    const postamble = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([preamble, audioBuffer, postamble]);

    this.logger.debug(`Sending audio transcription request to ${endpoint} with model ${model}`);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!res.ok) {
      const errText = await res.text();
      this.logger.error(`Whisper API transcription failed (${res.status}): ${errText}`);
      throw new Error(`Whisper transcription failed: HTTP ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as { text?: string };
    const transcript = (data.text || '').trim();
    this.logger.debug(`Transcription succeeded: "${transcript.slice(0, 100)}..."`);
    return transcript;
  }
}
