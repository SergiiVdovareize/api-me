import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { CatcastService } from './catcast.service';
import { RedisReader } from '../common/helpers/redisReader';

describe('CatcastService', () => {
  let service: CatcastService;
  let configService: jest.Mocked<Partial<ConfigService>>;
  let redisReader: jest.Mocked<Partial<RedisReader>>;
  let redisStorage: Map<string, any>;

  beforeEach(async () => {
    redisStorage = new Map();
    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'CATCAST_ACCESS_KEYS') {
          return 'secret-key-1, secret-key-2';
        }
        return null;
      }),
    };

    redisReader = {
      read: jest.fn().mockImplementation(async (k: string) => redisStorage.get(k) || null),
      write: jest.fn().mockImplementation(async (k: string, v: any) => {
        redisStorage.set(k, v);
        return 'OK';
      }),
      delete: jest.fn().mockImplementation(async (k: string) => {
        redisStorage.delete(k);
        return 1;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CatcastService,
        { provide: ConfigService, useValue: configService },
        { provide: RedisReader, useValue: redisReader },
      ],
    }).compile();

    service = module.get<CatcastService>(CatcastService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should parse allowed keys from config', () => {
    expect(service.getAllowedKeys()).toEqual(['secret-key-1', 'secret-key-2']);
  });

  it('should throw BadRequestException when key is missing or empty', async () => {
    await expect(service.verifyAccess('', '1.2.3.4')).rejects.toThrow(BadRequestException);
    await expect(service.verifyAccess(undefined, '1.2.3.4')).rejects.toThrow(BadRequestException);
  });

  it('should throw UnauthorizedException when key is not in allowed list', async () => {
    await expect(service.verifyAccess('wrong-key', '1.2.3.4')).rejects.toThrow(UnauthorizedException);
  });

  it('should bind IP on first access with valid key', async () => {
    const result = await service.verifyAccess('secret-key-1', '1.2.3.4');
    expect(result.success).toBe(true);
    expect(result.boundIp).toBe('1.2.3.4');
    expect(result.isNewBinding).toBe(true);
  });

  it('should allow access from the same IP on subsequent calls', async () => {
    await service.verifyAccess('secret-key-1', '1.2.3.4');
    const result2 = await service.verifyAccess('secret-key-1', '1.2.3.4');
    expect(result2.success).toBe(true);
    expect(result2.boundIp).toBe('1.2.3.4');
    expect(result2.isNewBinding).toBe(false);
  });

  it('should throw ForbiddenException (IP_MISMATCH) when key is used from different IP', async () => {
    await service.verifyAccess('secret-key-1', '1.2.3.4');
    await expect(service.verifyAccess('secret-key-1', '5.6.7.8')).rejects.toThrow(ForbiddenException);
  });

  it('should handle IPv6-wrapped IPv4 addresses cleanly', async () => {
    const result = await service.verifyAccess('secret-key-2', '::ffff:192.168.1.100');
    expect(result.boundIp).toBe('192.168.1.100');
  });

  it('should reset binding correctly', async () => {
    await service.verifyAccess('secret-key-1', '1.2.3.4');
    await service.resetBinding('secret-key-1');
    // Now another IP can bind
    const result = await service.verifyAccess('secret-key-1', '9.9.9.9');
    expect(result.success).toBe(true);
    expect(result.boundIp).toBe('9.9.9.9');
  });
});
