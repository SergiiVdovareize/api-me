import { ProviderConfig } from '../interfaces/llm.interface';

export const LLM_CONFIGS: Record<string, ProviderConfig> = {
  mistral: {
    baseURL: process.env.MISTRAL_BASE_URL || 'https://api.mistral.ai/v1',
    defaultModel: process.env.MISTRAL_MODEL || 'ministral-8b-latest',
  },
  openai: {
    baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    defaultModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  },
  openrouter: {
    baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    defaultModel: process.env.OPENROUTER_MODEL || 'mistralai/mistral-small-latest',
  },
  groq: {
    baseURL: process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
    defaultModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  },
};
