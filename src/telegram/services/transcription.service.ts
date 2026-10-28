import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TranscriptionService {
  private readonly logger = new Logger(TranscriptionService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Transcribes an audio buffer to text using Groq Whisper or OpenAI Whisper API.
   *
   * @param audioBuffer Binary buffer of the voice/audio file
   * @param mimeType Audio MIME type (e.g. 'audio/ogg', 'audio/mp4')
   * @returns Transcribed text in plain text
   */
  async transcribeAudio(audioBuffer: Buffer, mimeType: string = 'audio/ogg'): Promise<string> {
    const groqApiKey = this.configService.get<string>('GROQ_API_KEY')?.trim();
    const openAiApiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();

    if (!groqApiKey && !openAiApiKey) {
      this.logger.warn('Neither GROQ_API_KEY nor OPENAI_API_KEY configured. Returning fallback transcription placeholder.');
      return 'Voice memo recorded, but Whisper transcription API key is not configured.';
    }

    const apiUrl = groqApiKey
      ? 'https://api.groq.com/openai/v1/audio/transcriptions'
      : 'https://api.openai.com/v1/audio/transcriptions';

    const apiKey = groqApiKey || openAiApiKey;
    const model = groqApiKey ? 'whisper-large-v3' : 'whisper-1';

    const formData = new FormData();
    const extension = mimeType.includes('mp4') || mimeType.includes('m4a') ? 'm4a' : 'ogg';
    const blob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
    formData.append('file', blob, `voice_memo.${extension}`);
    formData.append('model', model);

    this.logger.log(`Transcribing audio via ${groqApiKey ? 'Groq' : 'OpenAI'} (${model})...`);

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!res.ok) {
      const err = await res.text();
      this.logger.error(`Transcription request failed (${res.status}): ${err}`);
      throw new Error(`Audio transcription API failed: HTTP ${res.status}`);
    }

    const data = (await res.json()) as { text?: string };
    const transcription = data.text?.trim() || '';
    this.logger.log(`Audio transcribed successfully (${transcription.length} chars).`);
    return transcription;
  }
}
