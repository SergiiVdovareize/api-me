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
        if (key === 'LATEST_CLIENT_VERSION') {
          return '1.8.12';
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

  it('should return latest client version from config or default fallback', () => {
    expect(service.getLatestVersion()).toBe('1.8.12');
  });

  it('should throw BadRequestException with latestVersion when key is missing or empty', async () => {
    try {
      await service.verifyAccess({ key: '', deviceId: 'dev-1' }, '1.2.3.4');
      fail('Expected BadRequestException');
    } catch (err: any) {
      expect(err).toBeInstanceOf(BadRequestException);
      const res = err.getResponse();
      expect(res.success).toBe(false);
      expect(res.latestVersion).toBe('1.8.12');
      expect(res.error).toBe('KEY_REQUIRED');
    }
  });

  it('should throw BadRequestException with latestVersion when deviceId is missing or empty', async () => {
    try {
      await service.verifyAccess({ key: 'secret-key-1', deviceId: '' }, '1.2.3.4');
      fail('Expected BadRequestException');
    } catch (err: any) {
      expect(err).toBeInstanceOf(BadRequestException);
      const res = err.getResponse();
      expect(res.success).toBe(false);
      expect(res.latestVersion).toBe('1.8.12');
      expect(res.error).toBe('DEVICE_ID_REQUIRED');
    }
  });

  it('should throw UnauthorizedException with latestVersion when key is not in allowed list', async () => {
    try {
      await service.verifyAccess({ key: 'wrong-key', deviceId: 'dev-1' }, '1.2.3.4');
      fail('Expected UnauthorizedException');
    } catch (err: any) {
      expect(err).toBeInstanceOf(UnauthorizedException);
      const res = err.getResponse();
      expect(res.success).toBe(false);
      expect(res.latestVersion).toBe('1.8.12');
      expect(res.error).toBe('INVALID_KEY');
    }
  });

  it('should bind deviceId, platform and include latestVersion on first access with valid key', async () => {
    const result = await service.verifyAccess(
      { key: 'secret-key-1', deviceId: 'android_9774d56d682e549c', platform: 'android_tv' },
      '1.2.3.4'
    );
    expect(result.success).toBe(true);
    expect(result.latestVersion).toBe('1.8.12');
    expect(result.boundDeviceId).toBe('android_9774d56d682e549c');
    expect(result.boundIp).toBe('1.2.3.4');
    expect(result.isNewBinding).toBe(true);
    expect(result.platform).toBe('android_tv');
  });

  it('should allow access from the same deviceId on subsequent calls regardless of IP changes', async () => {
    await service.verifyAccess(
      { key: 'secret-key-1', deviceId: 'android_9774d56d682e549c', platform: 'android_tv' },
      '1.2.3.4'
    );
    // Same device from different mobile / Wi-Fi IP
    const result2 = await service.verifyAccess(
      { key: 'secret-key-1', deviceId: 'android_9774d56d682e549c', platform: 'android_tv' },
      '5.6.7.8'
    );
    expect(result2.success).toBe(true);
    expect(result2.latestVersion).toBe('1.8.12');
    expect(result2.boundDeviceId).toBe('android_9774d56d682e549c');
    expect(result2.boundIp).toBe('5.6.7.8');
    expect(result2.isNewBinding).toBe(false);
    expect(result2.platform).toBe('android_tv');
  });

  it('should throw ForbiddenException (DEVICE_MISMATCH) with latestVersion when key is used from different deviceId', async () => {
    await service.verifyAccess(
      { key: 'secret-key-1', deviceId: 'android_9774d56d682e549c' },
      '1.2.3.4'
    );
    try {
      await service.verifyAccess(
        { key: 'secret-key-1', deviceId: 'web_550e8400-e29b-41d4-a716-446655440000' },
        '1.2.3.4'
      );
      fail('Expected ForbiddenException');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ForbiddenException);
      const res = err.getResponse();
      expect(res.success).toBe(false);
      expect(res.latestVersion).toBe('1.8.12');
      expect(res.error).toBe('DEVICE_MISMATCH');
    }
  });

  it('should migrate legacy IP binding seamlessly on first device request', async () => {
    // Simulate legacy redis entry stored under old catcast:auth:ip: prefix
    redisStorage.set('catcast:auth:ip:secret-key-1', '1.2.3.4');

    const result = await service.verifyAccess(
      { key: 'secret-key-1', deviceId: 'tizen_duid_abc', platform: 'tizen_tv' },
      '1.2.3.4'
    );

    expect(result.success).toBe(true);
    expect(result.latestVersion).toBe('1.8.12');
    expect(result.boundDeviceId).toBe('tizen_duid_abc');
    expect(result.isNewBinding).toBe(true);
    expect(result.platform).toBe('tizen_tv');
    // Legacy IP key was cleaned up
    expect(redisStorage.has('catcast:auth:ip:secret-key-1')).toBe(false);
  });

  it('should reset binding correctly', async () => {
    await service.verifyAccess({ key: 'secret-key-1', deviceId: 'android_device_1' }, '1.2.3.4');
    await service.resetBinding('secret-key-1');

    // Now another device can bind
    const result = await service.verifyAccess(
      { key: 'secret-key-1', deviceId: 'android_device_2' },
      '9.9.9.9'
    );
    expect(result.success).toBe(true);
    expect(result.latestVersion).toBe('1.8.12');
    expect(result.boundDeviceId).toBe('android_device_2');
    expect(result.isNewBinding).toBe(true);
  });
});
