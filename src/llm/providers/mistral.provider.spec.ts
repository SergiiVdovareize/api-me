import { MistralProvider } from './mistral.provider';

describe('MistralProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it('should call Mistral chat completions endpoint with correct payload and headers', async () => {
    const mockJson = {
      choices: [{ message: { content: 'Test response from Mistral' } }],
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockJson,
      headers: new Headers(),
    } as any);

    const provider = new MistralProvider('test-api-key', 'mistral-small-latest');
    const result = await provider.call('System prompt', 'User prompt', {
      temperature: 0.5,
      maxTokens: 100,
    });

    expect(result).toBe('Test response from Mistral');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.mistral.ai/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-api-key',
        }),
        body: JSON.stringify({
          model: 'mistral-small-latest',
          messages: [
            { role: 'system', content: 'System prompt' },
            { role: 'user', content: 'User prompt' },
          ],
          temperature: 0.5,
          max_tokens: 100,
        }),
      })
    );
  });

  it('should throw error with status code and headers when response is not ok', async () => {
    const headers = new Headers();
    headers.set('retry-after', '60');
    headers.set('content-type', 'application/json');

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers,
      json: async () => ({ message: 'Rate limit reached' }),
    } as any);

    const provider = new MistralProvider('test-api-key');

    await expect(provider.call('System', 'User')).rejects.toMatchObject({
      message: expect.stringContaining('Rate limit reached'),
      status: 429,
      statusCode: 429,
      headers: expect.objectContaining({ 'retry-after': '60' }),
    });
  });

  it('should handle timeout abort cleanly', async () => {
    global.fetch = jest.fn().mockImplementation(() => {
      const error: any = new Error('The operation was aborted');
      error.name = 'AbortError';
      return Promise.reject(error);
    });

    const provider = new MistralProvider('test-api-key');
    await expect(provider.call('System', 'User', { timeoutMs: 50 })).rejects.toThrow(
      'Mistral API request timed out after 50ms'
    );
  });
});
