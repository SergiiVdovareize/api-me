import { Logger } from '@nestjs/common';
import { LLMCallOptions, LLMProvider, ProviderItem } from '../interfaces/llm.interface';

/** Extracts cooldown time in seconds from HTTP headers or error message text */
export function extractCooldownSeconds(err: any): number {
  const errMsg = (err?.message || err?.toString() || '').toLowerCase();

  // 1. Check HTTP headers (retry-after)
  const headers = err?.headers || err?.response?.headers || err?.error?.headers;
  if (headers) {
    const retryAfter = headers['retry-after'] || headers['Retry-After'];
    if (retryAfter) {
      const parsedHeader = parseInt(retryAfter, 10);
      if (!isNaN(parsedHeader) && parsedHeader > 0) return parsedHeader;
    }
  }

  // 2. Check for explicit time patterns in error message (e.g. "try again in 20s")
  const match = errMsg.match(
    /(?:try again in|retry after|in)\s+(\d+)\s*(s|sec|second|m|min|minute|h|hour)s?/i
  );
  if (match) {
    const val = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    if (!isNaN(val)) {
      if (unit.startsWith('s')) return val;
      if (unit.startsWith('m')) return val * 60;
      if (unit.startsWith('h')) return val * 3600;
    }
  }

  // 3. Check if error is a 429 / Rate Limit error
  const isRateLimit =
    err?.status === 429 ||
    err?.statusCode === 429 ||
    errMsg.includes('429') ||
    errMsg.includes('rate limit') ||
    errMsg.includes('quota') ||
    errMsg.includes('too many requests');

  if (isRateLimit) {
    return 300; // Default 5-minute fallback cooldown for rate limits
  }

  return 0;
}

export class LLMRouterProvider implements LLMProvider {
  private readonly logger = new Logger(LLMRouterProvider.name);
  private providers: ProviderItem[];
  private cooldowns: Map<string, number> = new Map();

  constructor(providers: ProviderItem[]) {
    this.providers = [...providers];
    this.logActiveStatus();
  }

  public getProviders(): ProviderItem[] {
    return this.providers;
  }

  public getCooldowns(): Map<string, number> {
    return this.cooldowns;
  }

  public resetCooldowns(): void {
    this.cooldowns.clear();
  }

  public isCoolingDown(name: string): boolean {
    const until = this.cooldowns.get(name);
    if (!until) return false;
    if (Date.now() >= until) {
      this.cooldowns.delete(name);
      return false;
    }
    return true;
  }

  private logActiveStatus(): void {
    if (this.providers.length === 0) return;

    const readyNames = this.providers.filter(p => !this.isCoolingDown(p.name)).map(p => p.name);
    const coolingInfo = this.providers
      .filter(p => this.isCoolingDown(p.name))
      .map(p => {
        const until = this.cooldowns.get(p.name)!;
        const remainingSec = Math.ceil((until - Date.now()) / 1000);
        return `${p.name} (${remainingSec}s remaining)`;
      });

    let msg = `🔄 LLM Router initialized with ${this.providers.length} key(s): [${readyNames.join(', ')}]`;
    if (coolingInfo.length > 0) {
      msg += ` | Cooling down: [${coolingInfo.join(', ')}]`;
    }
    this.logger.log(msg);
  }

  async call(systemPrompt: string, userPrompt: string, options?: LLMCallOptions): Promise<string> {
    if (this.providers.length === 0) {
      throw new Error('LLMRouterProvider has no configured target providers.');
    }

    let attempts = 0;
    const totalProviders = this.providers.length;

    while (attempts < totalProviders) {
      const current = this.providers[0];

      // If current provider is cooling down, rotate to end of queue and try next
      if (this.isCoolingDown(current.name)) {
        const until = this.cooldowns.get(current.name)!;
        const remainingSec = Math.ceil((until - Date.now()) / 1000);
        this.logger.debug(
          `⏳ Provider key '${current.name}' is cooling down (${remainingSec}s remaining). Skipping...`
        );
        this.providers.shift();
        this.providers.push(current);
        attempts++;
        continue;
      }

      try {
        this.logger.debug(`🤖 Calling AI via provider key '${current.name}'...`);
        const result = await current.instance.call(systemPrompt, userPrompt, options);

        // Rotate provider to end of queue on success for round-robin load balancing
        this.providers.shift();
        this.providers.push(current);

        return result;
      } catch (err: any) {
        attempts++;
        const cooldownSec = extractCooldownSeconds(err);

        if (cooldownSec > 0) {
          const cooldownUntil = Date.now() + cooldownSec * 1000;
          this.cooldowns.set(current.name, cooldownUntil);
          const untilTime = new Date(cooldownUntil).toLocaleTimeString();
          this.logger.warn(
            `⚠️ Provider '${current.name}' rate-limited (${err.message}). Cooldown for ${cooldownSec}s (until ${untilTime}).`
          );
        } else {
          this.logger.warn(`⚠️ Provider '${current.name}' failed: ${err.message || err}`);
        }

        // Move failed provider to the end of rotation queue
        this.providers.shift();
        this.providers.push(current);

        if (attempts < totalProviders) {
          const next = this.providers[0];
          this.logger.log(
            `🔄 Switching to next AI key/provider '${next.name}' (attempt ${attempts + 1} of ${totalProviders})...`
          );
        } else {
          throw new Error(
            `All ${totalProviders} AI provider key(s) failed or are in cooldown. Last error: ${err.message || err}`
          );
        }
      }
    }

    throw new Error('All configured LLM providers are currently cooling down or failed.');
  }
}
