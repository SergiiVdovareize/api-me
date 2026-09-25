import { Logger } from '@nestjs/common';
import { LLMProvider } from '../interfaces/llm.interface';

export class MockProvider implements LLMProvider {
  private readonly logger = new Logger(MockProvider.name);

  async call(): Promise<string> {
    this.logger.error('No active LLM API key configured in environment.');
    throw new Error(
      'LLM Provider is not configured with active API keys. Please set MISTRAL_API_KEY in environment variables.'
    );
  }
}
