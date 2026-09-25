import { LLMProvider, ProviderItem } from '../interfaces/llm.interface';
import { LLMRouterProvider, extractCooldownSeconds } from './router.provider';

describe('extractCooldownSeconds', () => {
  it('should extract retry-after header as seconds', () => {
    const err = { headers: { 'retry-after': '45' } };
    expect(extractCooldownSeconds(err)).toBe(45);
  });

  it('should extract seconds from text message pattern', () => {
    const err = new Error('Rate limit exceeded. Please try again in 30s.');
    expect(extractCooldownSeconds(err)).toBe(30);
  });

  it('should extract minutes from text message pattern and convert to seconds', () => {
    const err = new Error('Quota exceeded, retry after 2 minutes');
    expect(extractCooldownSeconds(err)).toBe(120);
  });

  it('should return default 300s for generic 429 status', () => {
    const err = { status: 429, message: 'Too Many Requests' };
    expect(extractCooldownSeconds(err)).toBe(300);
  });

  it('should return 0 for ordinary errors without rate limit indication', () => {
    const err = new Error('Connection refused');
    expect(extractCooldownSeconds(err)).toBe(0);
  });
});

describe('LLMRouterProvider', () => {
  let mockProvider1: jest.Mocked<LLMProvider>;
  let mockProvider2: jest.Mocked<LLMProvider>;
  let providers: ProviderItem[];

  beforeEach(() => {
    mockProvider1 = { call: jest.fn() };
    mockProvider2 = { call: jest.fn() };
    providers = [
      { name: 'mistral_1', instance: mockProvider1 },
      { name: 'mistral_2', instance: mockProvider2 },
    ];
  });

  it('should throw error if initialized with empty providers array', async () => {
    const router = new LLMRouterProvider([]);
    await expect(router.call('sys', 'user')).rejects.toThrow(
      'LLMRouterProvider has no configured target providers.'
    );
  });

  it('should rotate keys in round-robin order upon successful calls', async () => {
    mockProvider1.call.mockResolvedValue('Response 1');
    mockProvider2.call.mockResolvedValue('Response 2');

    const router = new LLMRouterProvider(providers);

    // Call 1 -> uses mistral_1
    const res1 = await router.call('sys', 'user');
    expect(res1).toBe('Response 1');
    expect(mockProvider1.call).toHaveBeenCalledTimes(1);
    expect(mockProvider2.call).toHaveBeenCalledTimes(0);

    // Call 2 -> rotated to mistral_2
    const res2 = await router.call('sys', 'user');
    expect(res2).toBe('Response 2');
    expect(mockProvider1.call).toHaveBeenCalledTimes(1);
    expect(mockProvider2.call).toHaveBeenCalledTimes(1);

    // Call 3 -> rotated back to mistral_1
    const res3 = await router.call('sys', 'user');
    expect(res3).toBe('Response 1');
    expect(mockProvider1.call).toHaveBeenCalledTimes(2);
  });

  it('should fail over to next provider when current provider encounters an error', async () => {
    mockProvider1.call.mockRejectedValue(new Error('Network drop on provider 1'));
    mockProvider2.call.mockResolvedValue('Response from provider 2');

    const router = new LLMRouterProvider(providers);
    const res = await router.call('sys', 'user');

    expect(res).toBe('Response from provider 2');
    expect(mockProvider1.call).toHaveBeenCalledTimes(1);
    expect(mockProvider2.call).toHaveBeenCalledTimes(1);
  });

  it('should place rate-limited provider on cooldown and use next available provider', async () => {
    const rateLimitErr: any = new Error('Rate limit reached');
    rateLimitErr.status = 429;
    rateLimitErr.headers = { 'retry-after': '60' };

    mockProvider1.call.mockRejectedValue(rateLimitErr);
    mockProvider2.call.mockResolvedValue('Response from provider 2');

    const router = new LLMRouterProvider(providers);
    const res1 = await router.call('sys', 'user');

    expect(res1).toBe('Response from provider 2');
    expect(router.isCoolingDown('mistral_1')).toBe(true);

    // Subsequent call should skip mistral_1 directly because it is in cooldown
    mockProvider2.call.mockResolvedValue('Another response from provider 2');
    const res2 = await router.call('sys', 'user');

    expect(res2).toBe('Another response from provider 2');
    // mistral_1 should not have been called a second time
    expect(mockProvider1.call).toHaveBeenCalledTimes(1);
  });

  it('should throw error when all providers fail', async () => {
    mockProvider1.call.mockRejectedValue(new Error('Fail 1'));
    mockProvider2.call.mockRejectedValue(new Error('Fail 2'));

    const router = new LLMRouterProvider(providers);

    await expect(router.call('sys', 'user')).rejects.toThrow(
      'All 2 AI provider key(s) failed or are in cooldown'
    );
  });
});
