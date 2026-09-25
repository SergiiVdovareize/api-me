export interface LLMCallOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface LLMProvider {
  call(systemPrompt: string, userPrompt: string, options?: LLMCallOptions): Promise<string>;
}

export interface ProviderItem {
  name: string;
  instance: LLMProvider;
}

export interface RouterState {
  lastUpdated: string;
  providerOrder: string[];
  cooldowns: Record<string, number>;
}

export interface ProviderConfig {
  baseURL: string;
  defaultHeaders?: Record<string, string>;
  defaultModel?: string;
}
