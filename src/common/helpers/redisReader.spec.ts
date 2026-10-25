import { ConfigService } from '@nestjs/config';
import { RedisReader } from './redisReader';
import { Redis } from '@upstash/redis';

jest.mock('@upstash/redis');
jest.mock('@sentry/nestjs');

describe('RedisReader', () => {
  let reader: RedisReader;
  let mockConfigService: jest.Mocked<Partial<ConfigService>>;
  let mockRedisClient: any;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      UPSTASH_REDIS_REST_URL_ONE: 'https://redis-one.upstash.io',
      UPSTASH_REDIS_REST_TOKEN_ONE: 'token-one',
      UPSTASH_REDIS_REST_URL_TWO: 'https://redis-two.upstash.io',
      UPSTASH_REDIS_REST_TOKEN_TWO: 'token-two',
    };

    mockRedisClient = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };

    (Redis as unknown as jest.Mock).mockImplementation(() => mockRedisClient);

    mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        return process.env[key];
      }),
    };

    reader = new RedisReader(mockConfigService as unknown as ConfigService);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  it('should initialize redisPairs from process.env', () => {
    expect(reader.getRedisPairNumber()).toBeGreaterThanOrEqual(0);
  });

  it('should return null if restUrl is missing or invalid', () => {
    expect(reader.getRedisPair('')).toBeNull();
    expect(reader.getRedisPair('INVALID_PREFIX')).toBeNull();
  });

  it('should return null if url or token is missing in configService', () => {
    (mockConfigService.get as jest.Mock).mockReturnValue(undefined);
    expect(reader.getRedisPair('UPSTASH_REDIS_REST_URL_ONE')).toBeNull();
  });

  it('should create and cache Redis client in pool', () => {
    const client1 = reader.getRedisPair('UPSTASH_REDIS_REST_URL_ONE');
    const client2 = reader.getRedisPair('UPSTASH_REDIS_REST_URL_ONE');
    expect(client1).toBe(client2);
    expect(Redis).toHaveBeenCalledTimes(1);
  });

  it('should read from redis and handle exceptions', async () => {
    mockRedisClient.get.mockResolvedValue('test-val');
    const res = await reader.read('test-key');
    expect(res).toBe('test-val');

    mockRedisClient.get.mockRejectedValue(new Error('Redis read failure'));
    const failedRes = await reader.read('test-key');
    expect(failedRes).toBeNull();
  });

  it('should return null on read when redis is not configured', async () => {
    const emptyReader = new RedisReader({ get: jest.fn() } as any);
    const res = await emptyReader.read('key');
    expect(res).toBeNull();
  });

  it('should write to redis with default and custom TTL', async () => {
    mockRedisClient.set.mockResolvedValue('OK');

    await reader.write('key1', 'val1');
    expect(mockRedisClient.set).toHaveBeenCalledWith('key1', 'val1', { ex: 100800 });

    await reader.write('key2', 'val2', 3600);
    expect(mockRedisClient.set).toHaveBeenCalledWith('key2', 'val2', { ex: 3600 });
  });

  it('should return null on write when redis is not configured', async () => {
    const emptyReader = new RedisReader({ get: jest.fn() } as any);
    const res = await emptyReader.write('key', 'val');
    expect(res).toBeNull();
  });

  it('should delete from redis and handle errors', async () => {
    mockRedisClient.del.mockResolvedValue(1);
    const res = await reader.delete('key1');
    expect(res).toBe(1);

    mockRedisClient.del.mockRejectedValue(new Error('Delete error'));
    const failedRes = await reader.delete('key1');
    expect(failedRes).toBeNull();
  });

  it('should return null on delete when redis is not configured', async () => {
    const emptyReader = new RedisReader({ get: jest.fn() } as any);
    const res = await emptyReader.delete('key');
    expect(res).toBeNull();
  });

  it('should nudge all redis pairs successfully and handle failure in one', async () => {
    mockRedisClient.set
      .mockResolvedValueOnce('OK')
      .mockRejectedValueOnce(new Error('Nudge error'));

    await reader.nudgeAll();
    expect(mockRedisClient.set).toHaveBeenCalledTimes(2);
  });
});
