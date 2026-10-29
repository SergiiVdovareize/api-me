import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TranscriptionService {
  private readonly logger = new Logger(TranscriptionService.name);

  private mistralKeyIndex = 0;

  constructor(private readonly configService: ConfigService) {}

  /**
   * Resolves a Mistral API key from MISTRAL_API_KEY or indexed MISTRAL_API_KEY_1..N.
   * Round-robins across indexed keys if multiple exist.
   */
  private getMistralApiKey(): string | undefined {
    const baseKey = this.configService.get<string>('MISTRAL_API_KEY')?.trim() || process.env.MISTRAL_API_KEY?.trim();
    if (baseKey) return baseKey;

    const indexedKeys: string[] = [];
    for (let i = 1; i <= 20; i++) {
      const key =
        this.configService.get<string>(`MISTRAL_API_KEY_${i}`)?.trim() ||
        process.env[`MISTRAL_API_KEY_${i}`]?.trim();
      if (key) indexedKeys.push(key);
    }

    if (indexedKeys.length > 0) {
      const selected = indexedKeys[this.mistralKeyIndex % indexedKeys.length];
      this.mistralKeyIndex++;
      return selected;
    }

    return undefined;
  }

  /**
   * Transcribes an audio buffer to text using Groq Whisper, Mistral Voxtral, or OpenAI Whisper API.
   *
   * @param audioBuffer Binary buffer of the voice/audio file
   * @param mimeType Audio MIME type (e.g. 'audio/ogg', 'audio/mp4')
   * @returns Transcribed text in plain text
   */
  async transcribeAudio(audioBuffer: Buffer, mimeType: string = 'audio/ogg'): Promise<string> {
    const groqApiKey = this.configService.get<string>('GROQ_API_KEY')?.trim();
    const mistralApiKey = this.getMistralApiKey();
    const openAiApiKey = this.configService.get<string>('OPENAI_API_KEY')?.trim();

    if (!groqApiKey && !mistralApiKey && !openAiApiKey) {
      this.logger.warn(
        'Neither GROQ_API_KEY, MISTRAL_API_KEY nor OPENAI_API_KEY configured. Returning fallback transcription placeholder.'
      );
      return 'Voice memo recorded, but Whisper transcription API key is not configured.';
    }

    let apiUrl: string;
    let apiKey: string;
    let model: string;
    let providerName: string;

    if (groqApiKey) {
      apiUrl = 'https://api.groq.com/openai/v1/audio/transcriptions';
      apiKey = groqApiKey;
      model = 'whisper-large-v3';
      providerName = 'Groq';
    } else if (mistralApiKey) {
      apiUrl = 'https://api.mistral.ai/v1/audio/transcriptions';
      apiKey = mistralApiKey;
      model = this.configService.get<string>('MISTRAL_TRANSCRIBE_MODEL')?.trim() || 'voxtral-mini-transcribe-3';
      providerName = 'Mistral';
    } else {
      apiUrl = 'https://api.openai.com/v1/audio/transcriptions';
      apiKey = openAiApiKey!;
      model = 'whisper-1';
      providerName = 'OpenAI';
    }

    const formData = new FormData();
    const extension = mimeType.includes('mp4') || mimeType.includes('m4a') ? 'm4a' : 'ogg';
    const blob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
    formData.append('file', blob, `voice_memo.${extension}`);
    formData.append('model', model);

    this.logger.log(`Transcribing audio via ${providerName} (${model})...`);

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
