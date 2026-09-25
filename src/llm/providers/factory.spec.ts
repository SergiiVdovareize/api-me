import { ConfigService } from '@nestjs/config';
import { LLMProviderFactory } from './factory';
import { MistralProvider } from './mistral.provider';
import { MockProvider } from './mock.provider';
import { LLMRouterProvider } from './router.provider';

describe('LLMProviderFactory', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.MISTRAL_API_KEY;
    delete process.env.MISTRAL_API_KEY_1;
    delete process.env.MISTRAL_API_KEY_2;
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_ROUTER_PROVIDERS;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should return MockProvider when no API keys are configured', () => {
    const provider = LLMProviderFactory.createProvider();
    expect(provider).toBeInstanceOf(MockProvider);
  });

  it('should throw an error if MockProvider is called without API keys', async () => {
    const provider = LLMProviderFactory.createProvider();
    await expect(provider.call('sys', 'user')).rejects.toThrow(
      'LLM Provider is not configured with active API keys'
    );
  });

  it('should return a single MistralProvider when only base MISTRAL_API_KEY is configured', () => {
    process.env.MISTRAL_API_KEY = 'single-mistral-key';

    const provider = LLMProviderFactory.createProvider();
    expect(provider).toBeInstanceOf(MistralProvider);
  });

  it('should return LLMRouterProvider when multiple indexed keys are configured', () => {
    process.env.MISTRAL_API_KEY_1 = 'key-user-1';
    process.env.MISTRAL_API_KEY_2 = 'key-user-2';

    const provider = LLMProviderFactory.createProvider();
    expect(provider).toBeInstanceOf(LLMRouterProvider);
    const router = provider as LLMRouterProvider;
    expect(router.getProviders()).toHaveLength(2);
    expect(router.getProviders().map(p => p.name)).toEqual(['mistral_1', 'mistral_2']);
  });

  it('should support combining base key and indexed keys in LLMRouterProvider', () => {
    process.env.MISTRAL_API_KEY = 'base-key';
    process.env.MISTRAL_API_KEY_1 = 'key-user-1';

    const provider = LLMProviderFactory.createProvider();
    expect(provider).toBeInstanceOf(LLMRouterProvider);
    const router = provider as LLMRouterProvider;
    expect(router.getProviders()).toHaveLength(2);
    expect(router.getProviders().map(p => p.name)).toEqual(['mistral', 'mistral_1']);
  });

  it('should read keys via ConfigService if provided', () => {
    const mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'MISTRAL_API_KEY') return 'config-key';
        return undefined;
      }),
    } as unknown as ConfigService;

    const provider = LLMProviderFactory.createProvider(mockConfigService);
    expect(provider).toBeInstanceOf(MistralProvider);
  });
});
