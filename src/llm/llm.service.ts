import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LLMCallOptions, LLMProvider } from './interfaces/llm.interface';
import { LLMProviderFactory } from './providers/factory';

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private provider: LLMProvider;

  constructor(@Optional() private readonly configService?: ConfigService) {
    this.provider = LLMProviderFactory.createProvider(this.configService);
  }

  /**
   * Overrides or updates the active provider (e.g. for unit testing or custom router setup)
   */
  public setProvider(provider: LLMProvider): void {
    this.provider = provider;
  }

  /**
   * Returns the currently active provider instance
   */
  public getProvider(): LLMProvider {
    return this.provider;
  }

  /**
   * Raw text completion call
   */
  public async call(
    systemPrompt: string,
    userPrompt: string,
    options?: LLMCallOptions
  ): Promise<string> {
    return this.provider.call(systemPrompt, userPrompt, options);
  }

  /**
   * Calls the LLM and safely extracts, sanitizes, and parses JSON output.
   * If parsing fails, automatically retries with prompt reinforcement up to `retries` times.
   */
  public async callAndParseJSON<T>(
    systemPrompt: string,
    userPrompt: string,
    options?: LLMCallOptions,
    retries = 2
  ): Promise<T> {
    let currentSystemPrompt = systemPrompt;
    let currentUserPrompt = userPrompt;

    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      const responseRaw = await this.call(currentSystemPrompt, currentUserPrompt, options);
      try {
        let cleaned = responseRaw
          .replace(/```json/gi, '')
          .replace(/```/g, '')
          .trim();

        // Extract JSON boundaries in case there is text wrap/safety prefix
        const firstBracket = cleaned.indexOf('[');
        const firstBrace = cleaned.indexOf('{');

        let jsonStart = -1;
        let jsonEnd = -1;

        if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
          jsonStart = firstBracket;
          jsonEnd = cleaned.lastIndexOf(']');
        } else if (firstBrace !== -1) {
          jsonStart = firstBrace;
          jsonEnd = cleaned.lastIndexOf('}');
        }

        if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
          cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
        }

        try {
          return JSON.parse(cleaned) as T;
        } catch (initialParseErr: any) {
          const sanitized = this.sanitizeJsonControlCharacters(cleaned);
          return JSON.parse(sanitized) as T;
        }
      } catch (err: any) {
        if (attempt <= retries) {
          this.logger.warn(
            `⚠️ Failed to parse JSON from AI response on attempt ${attempt} (${err.message}). Retrying with reinforced prompt...`
          );
          currentSystemPrompt = `${systemPrompt}\n\nCRITICAL: Your previous response was not valid JSON. You MUST return ONLY the raw JSON block without markdown formatting or intro/outro explanations. Ensure all brackets, keys, and values are properly closed and valid JSON.`;
          currentUserPrompt = `${userPrompt}\n\n(Retry attempt ${attempt + 1}: Please ensure the response strictly matches the required JSON structure)`;
        } else {
          throw new Error(
            `Call to AI failed to return valid JSON after ${retries + 1} attempts. Raw response: "${responseRaw}". Error: ${err.message}`
          );
        }
      }
    }

    throw new Error('Call to AI failed to return valid JSON.');
  }

  /**
   * Sanitizes unescaped control characters (such as raw newlines or tabs) inside JSON string literals.
   */
  private sanitizeJsonControlCharacters(jsonStr: string): string {
    let inString = false;
    let isEscaped = false;
    let result = '';

    for (let i = 0; i < jsonStr.length; i++) {
      const char = jsonStr[i];

      if (char === '"' && !isEscaped) {
        inString = !inString;
        result += char;
      } else if (inString) {
        if (char === '\n') {
          result += '\\n';
        } else if (char === '\r') {
          result += '\\r';
        } else if (char === '\t') {
          result += '\\t';
        } else if (char.charCodeAt(0) < 0x20) {
          result += '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0');
        } else {
          result += char;
        }
      } else {
        result += char;
      }

      if (char === '\\' && !isEscaped) {
        isEscaped = true;
      } else {
        isEscaped = false;
      }
    }

    return result;
  }
}
