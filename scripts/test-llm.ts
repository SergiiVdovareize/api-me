import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { LlmModule } from '../src/llm/llm.module';
import { LlmService } from '../src/llm/llm.service';
import { LLMRouterProvider } from '../src/llm/providers/router.provider';

async function bootstrap() {
  const logger = new Logger('TestLlmRunner');
  logger.log('Starting LLM integration check...');

  // Inspect environment keys (safely masked)
  const mistralKeys = Object.keys(process.env)
    .filter(k => k.startsWith('MISTRAL_API_KEY'))
    .sort();

  if (mistralKeys.length === 0) {
    logger.warn('⚠️ No MISTRAL_API_KEY found in process.env / .env!');
    logger.warn('Please ensure MISTRAL_API_KEY (or MISTRAL_API_KEY_1, MISTRAL_API_KEY_2...) is added to .env in api-me.');
  } else {
    logger.log(`Found ${mistralKeys.length} Mistral key(s) in .env:`);
    for (const key of mistralKeys) {
      const val = process.env[key] || '';
      const masked = val.length > 8 ? `${val.slice(0, 4)}...${val.slice(-4)}` : '***';
      logger.log(`  - ${key}: ${masked}`);
    }
  }

  const app = await NestFactory.createApplicationContext(LlmModule, {
    logger: ['log', 'warn', 'error'],
  });

  try {
    const llmService = app.get(LlmService);
    const provider = llmService.getProvider();
    logger.log(`Active provider class: ${provider.constructor.name}`);

    if (provider instanceof LLMRouterProvider) {
      const names = provider.getProviders().map(p => p.name);
      logger.log(`Router targets: [${names.join(', ')}]`);
    }

    logger.log('\n--- 🧪 Sending test prompt to Mistral ---');
    const startTime = Date.now();
    const result = await llmService.callAndParseJSON<{ reply: string; status: string }>(
      'You are a helpful test assistant. Respond ONLY with valid JSON.',
      'Test connection. Return JSON with fields "reply" ("pong") and "status" ("ok").'
    );
    const elapsedMs = Date.now() - startTime;

    logger.log(`✅ Success in ${elapsedMs}ms! Response:`);
    console.log(JSON.stringify(result, null, 2));

    await app.close();
    process.exit(0);
  } catch (error: any) {
    logger.error(`❌ Call failed: ${error.message}`, error.stack);
    await app.close();
    process.exit(1);
  }
}

bootstrap();
