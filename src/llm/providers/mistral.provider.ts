import { LLMCallOptions, LLMProvider } from '../interfaces/llm.interface';

export class MistralProvider implements LLMProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseURL: string;
  private readonly defaultHeaders: Record<string, string>;

  constructor(
    apiKey: string,
    model = 'ministral-8b-latest',
    baseURL = 'https://api.mistral.ai/v1',
    defaultHeaders: Record<string, string> = {}
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseURL = baseURL.replace(/\/+$/, '');
    this.defaultHeaders = defaultHeaders;
  }

  async call(systemPrompt: string, userPrompt: string, options?: LLMCallOptions): Promise<string> {
    const url = `${this.baseURL}/chat/completions`;
    const controller = new AbortController();
    const timeout = options?.timeoutMs || 30000;
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          ...this.defaultHeaders,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: options?.temperature ?? 0.3,
          max_tokens: options?.maxTokens,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        let errMessage = `HTTP ${response.status} ${response.statusText}`;
        try {
          const errData = await response.json();
          if (errData?.message) {
            errMessage = errData.message;
          } else if (errData?.error?.message) {
            errMessage = errData.error.message;
          } else {
            errMessage = JSON.stringify(errData);
          }
        } catch {
          // ignore json parse errors
        }

        const headersObj: Record<string, string> = {};
        response.headers.forEach((val, key) => {
          headersObj[key.toLowerCase()] = val;
        });

        const error: any = new Error(`Mistral API Error (${response.status}): ${errMessage}`);
        error.status = response.status;
        error.statusCode = response.status;
        error.headers = headersObj;
        throw error;
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content || '';
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error(`Mistral API request timed out after ${timeout}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
