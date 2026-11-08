import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CatcastService } from './catcast.service';
import { RedisReader } from '../common/helpers/redisReader';
import { PrismaService } from '../models/prisma/prisma.service';

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

  describe('generateAccessKey', () => {
    it('should generate a 16-character lowercase alphanumeric string without prefixes', () => {
      const key = service.generateAccessKey();
      expect(key).toHaveLength(16);
      expect(key).toMatch(/^[a-z0-9]{16}$/);
    });

    it('should support custom length', () => {
      const key = service.generateAccessKey(20);
      expect(key).toHaveLength(20);
      expect(key).toMatch(/^[a-z0-9]{20}$/);
    });
  });

  it('should parse allowed keys from config', () => {
    expect(service.getAllowedKeys()).toEqual(['secret-key-1', 'secret-key-2']);
  });

  it('should throw BadRequestException when key is missing or empty', async () => {
    await expect(service.verifyAccess({ key: '', deviceId: 'dev-1' }, '1.2.3.4')).rejects.toThrow(
      BadRequestException
    );
    await expect(
      service.verifyAccess({ key: undefined, deviceId: 'dev-1' }, '1.2.3.4')
    ).rejects.toThrow(BadRequestException);
  });

  it('should throw BadRequestException when deviceId is missing or empty', async () => {
    await expect(
      service.verifyAccess({ key: 'secret-key-1', deviceId: '' }, '1.2.3.4')
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.verifyAccess({ key: 'secret-key-1', deviceId: undefined }, '1.2.3.4')
    ).rejects.toThrow(BadRequestException);
  });

  it('should throw UnauthorizedException when key is not in allowed list', async () => {
    await expect(
      service.verifyAccess({ key: 'wrong-key', deviceId: 'dev-1' }, '1.2.3.4')
    ).rejects.toThrow(UnauthorizedException);
  });

  it('should bind deviceId and platform on first access with valid key', async () => {
    const result = await service.verifyAccess(
      { key: 'secret-key-1', deviceId: 'android_9774d56d682e549c', platform: 'android_tv' },
      '1.2.3.4'
    );
    expect(result.success).toBe(true);
    expect(result.boundDeviceId).toBe('android_9774d56d682e549c');
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
    expect(result2.boundDeviceId).toBe('android_9774d56d682e549c');
    expect(result2.isNewBinding).toBe(false);
    expect(result2.platform).toBe('android_tv');
  });

  it('should allow access when deviceId differs only by case (case-insensitive check)', async () => {
    await service.verifyAccess(
      { key: 'secret-key-1', deviceId: 'android_9774d56d682e549c', platform: 'android_tv' },
      '1.2.3.4'
    );
    // Same device with uppercase / mixed case
    const result2 = await service.verifyAccess(
      { key: 'secret-key-1', deviceId: 'ANDROID_9774D56D682E549C', platform: 'android_tv' },
      '5.6.7.8'
    );
    expect(result2.success).toBe(true);
    expect(result2.isNewBinding).toBe(false);
  });

  it('should throw ForbiddenException (DEVICE_MISMATCH) when key is used from different deviceId', async () => {
    await service.verifyAccess(
      { key: 'secret-key-1', deviceId: 'android_9774d56d682e549c' },
      '1.2.3.4'
    );
    await expect(
      service.verifyAccess(
        { key: 'secret-key-1', deviceId: 'web_550e8400-e29b-41d4-a716-446655440000' },
        '1.2.3.4'
      )
    ).rejects.toThrow(ForbiddenException);
  });

  it('should migrate legacy IP binding seamlessly on first device request', async () => {
    // Simulate legacy redis entry stored under old catcast:auth:ip: prefix
    redisStorage.set('catcast:auth:ip:secret-key-1', '1.2.3.4');

    const result = await service.verifyAccess(
      { key: 'secret-key-1', deviceId: 'tizen_duid_abc', platform: 'tizen_tv' },
      '1.2.3.4'
    );

    expect(result.success).toBe(true);
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
    expect(result.boundDeviceId).toBe('android_device_2');
    expect(result.isNewBinding).toBe(true);
  });

  describe('Database backed operations', () => {
    let dbService: CatcastService;
    let mockPrisma: any;

    beforeEach(async () => {
      mockPrisma = {
        catcastKey: {
          findUnique: jest.fn(),
          findMany: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
          upsert: jest.fn(),
        },
        catcastDevice: {
          findUnique: jest.fn(),
          findMany: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
          updateMany: jest.fn(),
          upsert: jest.fn(),
        },
        catcastDeviceRequest: {
          findUnique: jest.fn(),
          findFirst: jest.fn(),
          findMany: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
          count: jest.fn(),
        },
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CatcastService,
          { provide: ConfigService, useValue: configService },
          { provide: RedisReader, useValue: redisReader },
          { provide: PrismaService, useValue: mockPrisma },
        ],
      }).compile();

      dbService = module.get<CatcastService>(CatcastService);
    });

    it('should create key in database', async () => {
      mockPrisma.catcastKey.create.mockResolvedValue({
        id: 10,
        key: 'catcast-test1234',
        label: 'Mom TV',
        isActive: true,
      });

      const result = await dbService.createKey('Mom TV', 'catcast-test1234');
      expect(result.key).toBe('catcast-test1234');
      expect(result.label).toBe('Mom TV');
      expect(mockPrisma.catcastKey.create).toHaveBeenCalledWith({
        data: {
          key: 'catcast-test1234',
          label: 'Mom TV',
          isActive: true,
        },
      });
    });

    it('should list keys from database', async () => {
      mockPrisma.catcastKey.findMany.mockResolvedValue([{ id: 1, key: 'k1', label: 'L1' }]);
      const list = await dbService.listKeys();
      expect(list).toHaveLength(1);
    });

    it('should verify and bind key from database on first use', async () => {
      mockPrisma.catcastKey.findUnique.mockResolvedValue({
        id: 1,
        key: 'db-key-1',
        isActive: true,
        boundDeviceId: null,
        createdAt: new Date(),
      });
      mockPrisma.catcastKey.update.mockResolvedValue({
        id: 1,
        key: 'db-key-1',
        isActive: true,
        boundDeviceId: 'android_dev_1',
      });

      const res = await dbService.verifyAccess(
        { key: 'db-key-1', deviceId: 'android_dev_1', platform: 'android_tv' },
        '1.2.3.4'
      );
      expect(res.success).toBe(true);
      expect(res.isNewBinding).toBe(true);
      expect(res.boundDeviceId).toBe('android_dev_1');
    });

    it('should throw UnauthorizedException and deactivate key if activated after 24 hours', async () => {
      const expiredCreatedAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
      mockPrisma.catcastKey.findUnique.mockResolvedValue({
        id: 99,
        key: 'expiredkey123456',
        isActive: true,
        boundDeviceId: null,
        createdAt: expiredCreatedAt,
      });
      mockPrisma.catcastKey.update.mockResolvedValue({
        id: 99,
        key: 'expiredkey123456',
        isActive: false,
      });

      await expect(
        dbService.verifyAccess(
          { key: 'expiredkey123456', deviceId: 'dev-1', platform: 'android_tv' },
          '1.2.3.4'
        )
      ).rejects.toThrow(UnauthorizedException);

      expect(mockPrisma.catcastKey.update).toHaveBeenCalledWith({
        where: { id: 99 },
        data: { isActive: false },
      });
    });

    it('should reject blocked key from database', async () => {
      mockPrisma.catcastKey.findUnique.mockResolvedValue({
        id: 1,
        key: 'blocked-key',
        isActive: false,
      });

      await expect(
        dbService.verifyAccess({ key: 'blocked-key', deviceId: 'dev-1' }, '1.2.3.4')
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reset key binding in database and redis', async () => {
      mockPrisma.catcastKey.findUnique.mockResolvedValue({
        id: 5,
        key: 'db-key-5',
        boundDeviceId: 'dev-5',
      });
      mockPrisma.catcastKey.update.mockResolvedValue({
        id: 5,
        key: 'db-key-5',
        boundDeviceId: null,
      });

      const res = await dbService.resetKeyBinding(5);
      expect(res.key).toBe('db-key-5');
      expect(mockPrisma.catcastKey.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: {
          boundDeviceId: null,
          platform: null,
          lastIp: null,
          createdAt: expect.any(Date),
        },
      });
    });

    it('should toggle key status in database', async () => {
      mockPrisma.catcastKey.findUnique.mockResolvedValue({
        id: 5,
        key: 'db-key-5',
        isActive: true,
      });
      mockPrisma.catcastKey.update.mockResolvedValue({
        id: 5,
        key: 'db-key-5',
        isActive: false,
      });

      const res = await dbService.toggleKey(5);
      expect(res.isActive).toBe(false);
    });

    describe('Device Access Management', () => {
      it('should throw BadRequestException if deviceId is missing in requestDeviceAccess', async () => {
        await expect(
          dbService.requestDeviceAccess({ deviceId: '', platform: 'android_tv' })
        ).rejects.toThrow(BadRequestException);
      });

      it('should throw Error if prisma is unavailable in requestDeviceAccess', async () => {
        await expect(
          service.requestDeviceAccess({ deviceId: 'dev_1', platform: 'web' })
        ).rejects.toThrow('Database service unavailable');
      });

      it('should return approved immediately if device is in allowlist', async () => {
        mockPrisma.catcastDevice.findUnique.mockResolvedValue({
          id: 1,
          deviceId: 'android_dev_allowed',
          isAllowed: true,
        });

        const res = await dbService.requestDeviceAccess({
          deviceId: 'android_dev_allowed',
          platform: 'android_tv',
        });

        expect(res.status).toBe('approved');
        expect(res.requestId).toBeNull();
        expect(mockPrisma.catcastDeviceRequest.create).not.toHaveBeenCalled();
      });

      it('should return existing live request if already pending within 30 min', async () => {
        mockPrisma.catcastDevice.findUnique.mockResolvedValue(null);
        const expiresAt = new Date(Date.now() + 20 * 60 * 1000);
        mockPrisma.catcastDeviceRequest.findFirst.mockResolvedValue({
          id: 'req_existing_123',
          deviceId: 'android_dev_pending',
          status: 'pending',
          expiresAt,
        });

        const res = await dbService.requestDeviceAccess({
          deviceId: 'android_dev_pending',
          platform: 'android_tv',
        });

        expect(res.status).toBe('pending');
        expect(res.requestId).toBe('req_existing_123');
        expect(res.expiresAt).toBe(expiresAt.toISOString());
        expect(mockPrisma.catcastDeviceRequest.create).not.toHaveBeenCalled();
      });

      it('should return rate limit error if device created >= 5 requests in last hour', async () => {
        mockPrisma.catcastDevice.findUnique.mockResolvedValue(null);
        mockPrisma.catcastDeviceRequest.findFirst.mockResolvedValue(null);
        mockPrisma.catcastDeviceRequest.count.mockResolvedValue(5);

        const res = await dbService.requestDeviceAccess({
          deviceId: 'android_spam_dev',
          platform: 'android_tv',
        });

        expect(res.error).toBe('RATE_LIMIT');
        expect(res.status).toBe('denied');
        expect(res.message).toContain('Забагато заявок');
        expect(mockPrisma.catcastDeviceRequest.create).not.toHaveBeenCalled();
      });

      it('should create new pending request and call notifier if available', async () => {
        mockPrisma.catcastDevice.findUnique.mockResolvedValue(null);
        mockPrisma.catcastDeviceRequest.findFirst.mockResolvedValue(null);
        mockPrisma.catcastDeviceRequest.count.mockResolvedValue(1);

        const createdRecord = {
          id: 'req_new_456',
          deviceId: 'android_new_dev',
          platform: 'android_tv',
          model: 'MIBOX4',
          os: '9',
          status: 'pending',
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
          createdAt: new Date(),
        };
        mockPrisma.catcastDeviceRequest.create.mockResolvedValue(createdRecord);
        mockPrisma.catcastDeviceRequest.update.mockResolvedValue(createdRecord);

        const mockNotifier = jest.fn().mockResolvedValue({ messageId: 999, chatId: '1252877' });
        dbService.setDeviceRequestNotifier(mockNotifier);

        const res = await dbService.requestDeviceAccess({
          deviceId: 'android_new_dev',
          platform: 'android_tv',
          model: 'MIBOX4',
          os: '9',
        });

        expect(res.status).toBe('pending');
        expect(res.requestId).toBe('req_new_456');
        expect(mockNotifier).toHaveBeenCalledWith(createdRecord);
        expect(mockPrisma.catcastDeviceRequest.update).toHaveBeenCalledWith({
          where: { id: 'req_new_456' },
          data: { telegramMessageId: 999, telegramChatId: '1252877' },
        });
      });

      it('should handle notifier rejection gracefully and default platform/model/os', async () => {
        mockPrisma.catcastDevice.findUnique.mockResolvedValue(null);
        mockPrisma.catcastDeviceRequest.findFirst.mockResolvedValue(null);
        mockPrisma.catcastDeviceRequest.count.mockResolvedValue(0);

        const createdRecord = {
          id: 'req_new_789',
          deviceId: 'android_dev_minimal',
          platform: 'unknown',
          model: null,
          os: null,
          status: 'pending',
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
          createdAt: new Date(),
        };
        mockPrisma.catcastDeviceRequest.create.mockResolvedValue(createdRecord);

        const mockFaultyNotifier = jest.fn().mockRejectedValue(new Error('Telegram down'));
        dbService.setDeviceRequestNotifier(mockFaultyNotifier);

        const res = await dbService.requestDeviceAccess({
          deviceId: 'android_dev_minimal',
          platform: '',
        });

        expect(res.status).toBe('pending');
        expect(res.requestId).toBe('req_new_789');
        expect(mockFaultyNotifier).toHaveBeenCalledWith(createdRecord);
      });

      describe('getDeviceStatus', () => {
        it('should return unknown if deviceId is empty or no requests found', async () => {
          expect(await dbService.getDeviceStatus('')).toEqual({
            status: 'unknown',
            expiresAt: null,
            requestId: null,
          });

          mockPrisma.catcastDevice.findUnique.mockResolvedValue(null);
          mockPrisma.catcastDeviceRequest.findFirst.mockResolvedValue(null);

          expect(await dbService.getDeviceStatus('dev-unknown')).toEqual({
            status: 'unknown',
            expiresAt: null,
            requestId: null,
          });
        });

        it('should return approved if device is in allowlist', async () => {
          mockPrisma.catcastDevice.findUnique.mockResolvedValue({
            id: 1,
            deviceId: 'dev_allowed',
            isAllowed: true,
          });

          const res = await dbService.getDeviceStatus('dev_allowed');
          expect(res.status).toBe('approved');
        });

        it('should return pending if request is active', async () => {
          mockPrisma.catcastDevice.findUnique.mockResolvedValue(null);
          const futureExpires = new Date(Date.now() + 15 * 60 * 1000);
          mockPrisma.catcastDeviceRequest.findFirst.mockResolvedValue({
            id: 'req_1',
            status: 'pending',
            expiresAt: futureExpires,
          });

          const res = await dbService.getDeviceStatus('dev_pending');
          expect(res.status).toBe('pending');
          expect(res.expiresAt).toBe(futureExpires.toISOString());
        });

        it('should return expired if pending request has passed expiresAt', async () => {
          mockPrisma.catcastDevice.findUnique.mockResolvedValue(null);
          const pastExpires = new Date(Date.now() - 5 * 60 * 1000);
          mockPrisma.catcastDeviceRequest.findFirst.mockResolvedValue({
            id: 'req_2',
            status: 'pending',
            expiresAt: pastExpires,
          });

          const res = await dbService.getDeviceStatus('dev_expired');
          expect(res.status).toBe('expired');
          expect(res.expiresAt).toBe(pastExpires.toISOString());
        });

        it('should return denied if latest request was denied', async () => {
          mockPrisma.catcastDevice.findUnique.mockResolvedValue(null);
          mockPrisma.catcastDeviceRequest.findFirst.mockResolvedValue({
            id: 'req_3',
            status: 'denied',
            expiresAt: new Date(),
          });

          const res = await dbService.getDeviceStatus('dev_denied');
          expect(res.status).toBe('denied');
        });

        it('should return unknown if latest request has unrecognized status or without prisma', async () => {
          mockPrisma.catcastDevice.findUnique.mockResolvedValue(null);
          mockPrisma.catcastDeviceRequest.findFirst.mockResolvedValue({
            id: 'req_other',
            status: 'canceled',
            expiresAt: new Date(),
          });

          const res = await dbService.getDeviceStatus('dev_other');
          expect(res.status).toBe('unknown');

          const noPrismaRes = await service.getDeviceStatus('dev_no_prisma');
          expect(noPrismaRes.status).toBe('unknown');
        });
      });

      describe('approveDeviceRequest & denyDeviceRequest', () => {
        it('should approve pending request and upsert CatcastDevice', async () => {
          mockPrisma.catcastDeviceRequest.findUnique.mockResolvedValue({
            id: 'req_app',
            deviceId: 'dev_app',
            platform: 'android_tv',
            model: 'MIBOX4',
            os: '9',
            status: 'pending',
          });
          mockPrisma.catcastDeviceRequest.update.mockResolvedValue({
            id: 'req_app',
            status: 'approved',
          });
          mockPrisma.catcastDevice.upsert.mockResolvedValue({
            id: 10,
            deviceId: 'dev_app',
            isAllowed: true,
          });

          const result = await dbService.approveDeviceRequest('req_app', '@admin');
          expect(result.success).toBe(true);
          expect(result.alreadyProcessed).toBe(false);
          expect(mockPrisma.catcastDevice.upsert).toHaveBeenCalledWith({
            where: { deviceId: 'dev_app' },
            create: {
              deviceId: 'dev_app',
              platform: 'android_tv',
              model: 'MIBOX4',
              os: '9',
              isAllowed: true,
            },
            update: {
              platform: 'android_tv',
              model: 'MIBOX4',
              os: '9',
              isAllowed: true,
            },
          });
        });

        it('should return alreadyProcessed: true when approving already approved request', async () => {
          mockPrisma.catcastDeviceRequest.findUnique.mockResolvedValue({
            id: 'req_app',
            deviceId: 'dev_app',
            status: 'approved',
          });

          const result = await dbService.approveDeviceRequest('req_app');
          expect(result.alreadyProcessed).toBe(true);
          expect(mockPrisma.catcastDeviceRequest.update).not.toHaveBeenCalled();
        });

        it('should throw NotFoundException if request not found in approveDeviceRequest', async () => {
          mockPrisma.catcastDeviceRequest.findUnique.mockResolvedValue(null);
          await expect(dbService.approveDeviceRequest('req_missing')).rejects.toThrow(
            NotFoundException
          );
        });

        it('should throw Error if prisma is missing in approveDeviceRequest', async () => {
          await expect(service.approveDeviceRequest('req_1')).rejects.toThrow(
            'Database service unavailable'
          );
        });

        it('should deny pending request', async () => {
          mockPrisma.catcastDeviceRequest.findUnique.mockResolvedValue({
            id: 'req_deny',
            deviceId: 'dev_deny',
            status: 'pending',
          });
          mockPrisma.catcastDeviceRequest.update.mockResolvedValue({
            id: 'req_deny',
            status: 'denied',
          });

          const result = await dbService.denyDeviceRequest('req_deny');
          expect(result.success).toBe(true);
          expect(result.alreadyProcessed).toBe(false);
          expect(mockPrisma.catcastDevice.updateMany).toHaveBeenCalledWith({
            where: { deviceId: 'dev_deny' },
            data: { isAllowed: false },
          });
        });

        it('should return alreadyProcessed: true when denying already denied request', async () => {
          mockPrisma.catcastDeviceRequest.findUnique.mockResolvedValue({
            id: 'req_deny',
            deviceId: 'dev_deny',
            status: 'denied',
          });

          const result = await dbService.denyDeviceRequest('req_deny');
          expect(result.alreadyProcessed).toBe(true);
          expect(mockPrisma.catcastDeviceRequest.update).not.toHaveBeenCalled();
        });

        it('should throw NotFoundException if request not found in denyDeviceRequest', async () => {
          mockPrisma.catcastDeviceRequest.findUnique.mockResolvedValue(null);
          await expect(dbService.denyDeviceRequest('req_missing')).rejects.toThrow(
            NotFoundException
          );
        });

        it('should throw Error if prisma is missing in denyDeviceRequest', async () => {
          await expect(service.denyDeviceRequest('req_1')).rejects.toThrow(
            'Database service unavailable'
          );
        });
      });

      describe('listAllowedDevices & revokeDeviceAccess', () => {
        it('should list allowed devices and return empty array if no prisma', async () => {
          mockPrisma.catcastDevice.findMany.mockResolvedValue([
            { id: 1, deviceId: 'dev_1', isAllowed: true },
          ]);
          const list = await dbService.listAllowedDevices();
          expect(list).toHaveLength(1);

          const emptyList = await service.listAllowedDevices();
          expect(emptyList).toEqual([]);
        });

        it('should revoke device access by numeric ID or string deviceId', async () => {
          mockPrisma.catcastDevice.findUnique.mockResolvedValue({
            id: 2,
            deviceId: 'dev_2',
            isAllowed: true,
          });
          mockPrisma.catcastDevice.update.mockResolvedValue({
            id: 2,
            deviceId: 'dev_2',
            isAllowed: false,
          });

          const res = await dbService.revokeDeviceAccess(2);
          expect(res.isAllowed).toBe(false);
          expect(mockPrisma.catcastDevice.update).toHaveBeenCalledWith({
            where: { id: 2 },
            data: { isAllowed: false },
          });

          // Test with string identifier
          await dbService.revokeDeviceAccess('dev_2');
          expect(mockPrisma.catcastDevice.findUnique).toHaveBeenCalledWith({
            where: { deviceId: 'dev_2' },
          });
        });

        it('should throw NotFoundException if device not found in revokeDeviceAccess', async () => {
          mockPrisma.catcastDevice.findUnique.mockResolvedValue(null);
          await expect(dbService.revokeDeviceAccess('unknown_device')).rejects.toThrow(
            NotFoundException
          );
        });

        it('should throw Error if prisma is missing in revokeDeviceAccess', async () => {
          await expect(service.revokeDeviceAccess(1)).rejects.toThrow(
            'Database service unavailable'
          );
        });
      });
    });
  });
});
