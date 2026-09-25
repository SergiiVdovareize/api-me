import { ConfigService } from '@nestjs/config';
import { LLM_CONFIGS } from '../config/llm.config';
import { LLMProvider, ProviderItem } from '../interfaces/llm.interface';
import { MistralProvider } from './mistral.provider';
import { MockProvider } from './mock.provider';
import { LLMRouterProvider } from './router.provider';

export class LLMProviderFactory {
  /**
   * Creates an LLMProvider instance (single, router, or mock) based on configured environment variables.
   */
  static createProvider(configService?: ConfigService): LLMProvider {
    const getEnv = (key: string): string | undefined =>
      configService?.get<string>(key) ?? process.env[key];

    const providerType = (getEnv('LLM_PROVIDER') || 'mistral').toLowerCase();

    // 1. Discover all keys for the primary provider (e.g. MISTRAL_API_KEY, MISTRAL_API_KEY_1, etc.)
    const instances = LLMProviderFactory.createInstancesForName(providerType, configService);

    // 2. Check if a custom list of router providers is specified (e.g. LLM_ROUTER_PROVIDERS="mistral,groq")
    const routerProvidersStr = getEnv('LLM_ROUTER_PROVIDERS');
    if (routerProvidersStr) {
      const names = routerProvidersStr
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);

      const items: ProviderItem[] = [];
      for (const name of names) {
        items.push(...LLMProviderFactory.createInstancesForName(name, configService));
      }

      if (items.length > 0) {
        return new LLMRouterProvider(items);
      }
    }

    if (instances.length > 1) {
      return new LLMRouterProvider(instances);
    }

    if (instances.length === 1) {
      return instances[0].instance;
    }

    return new MockProvider();
  }

  /**
   * Resolves provider instances for any given provider name
   * (supporting base key [NAME]_API_KEY and indexed keys [NAME]_API_KEY_1, [NAME]_API_KEY_2...)
   */
  static createInstancesForName(name: string, configService?: ConfigService): ProviderItem[] {
    const baseName = name.split('_')[0].toLowerCase();
    const envPrefix = baseName.toUpperCase();

    const getEnv = (key: string): string | undefined =>
      configService?.get<string>(key) ?? process.env[key];

    const foundInstances: ProviderItem[] = [];

    // 1. Check for base key (e.g. MISTRAL_API_KEY)
    const baseKey = getEnv(`${envPrefix}_API_KEY`)?.trim();
    if (baseKey) {
      const instance = LLMProviderFactory.createSingleProviderWithKey(
        baseName,
        baseKey,
        configService
      );
      foundInstances.push({ name: baseName, instance });
    }

    // 2. Auto-discover all indexed keys in process.env (e.g. MISTRAL_API_KEY_1, MISTRAL_API_KEY_2...)
    const indexedKeyNames = Object.keys(process.env)
      .filter(k => k.startsWith(`${envPrefix}_API_KEY_`) && k !== `${envPrefix}_API_KEY`)
      .sort((a, b) => {
        const numA = parseInt(a.replace(`${envPrefix}_API_KEY_`, ''), 10);
        const numB = parseInt(b.replace(`${envPrefix}_API_KEY_`, ''), 10);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return a.localeCompare(b);
      });

    for (const keyName of indexedKeyNames) {
      const apiKey = process.env[keyName]?.trim();
      if (apiKey) {
        const suffix = keyName.replace(`${envPrefix}_API_KEY_`, '');
        const instance = LLMProviderFactory.createSingleProviderWithKey(
          baseName,
          apiKey,
          configService
        );
        foundInstances.push({ name: `${baseName}_${suffix}`, instance });
      }
    }

    return foundInstances;
  }

  /**
   * Instantiates a single provider using a specified API key.
   * Can easily be extended for other providers (Groq, OpenAI, etc.).
   */
  static createSingleProviderWithKey(
    providerType: string,
    apiKey: string,
    configService?: ConfigService
  ): LLMProvider {
    const base = providerType.toLowerCase();
    const envPrefix = base.toUpperCase();

    const getEnv = (key: string): string | undefined =>
      configService?.get<string>(key) ?? process.env[key];

    const config = LLM_CONFIGS[base] || LLM_CONFIGS.mistral;
    const model = getEnv(`${envPrefix}_MODEL`) || config.defaultModel;
    const baseURL = getEnv(`${envPrefix}_BASE_URL`) || config.baseURL;

    switch (base) {
      case 'mistral':
      default:
        return new MistralProvider(apiKey, model, baseURL, config.defaultHeaders);
    }
  }
}
