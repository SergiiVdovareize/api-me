import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, UnauthorizedException, NotFoundException } from '@nestjs/common';
import { CatcastService, deriveDeviceRequestCode } from './catcast.service';
import { PrismaService } from '../models/prisma/prisma.service';

describe('CatcastService', () => {
  let service: CatcastService;
  let dbService: CatcastService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
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

    const moduleWithoutPrisma: TestingModule = await Test.createTestingModule({
      providers: [CatcastService],
    }).compile();

    service = moduleWithoutPrisma.get<CatcastService>(CatcastService);

    const moduleWithPrisma: TestingModule = await Test.createTestingModule({
      providers: [CatcastService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    dbService = moduleWithPrisma.get<CatcastService>(CatcastService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(dbService).toBeDefined();
  });

  describe('deriveDeviceRequestCode', () => {
    it('should derive a 4-character uppercase alphanumeric code from requestId', () => {
      const code = deriveDeviceRequestCode('req_test_1234');
      expect(code).toHaveLength(4);
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
    });

    it('should be deterministic for the same requestId', () => {
      const code1 = deriveDeviceRequestCode('req_same_id');
      const code2 = deriveDeviceRequestCode('req_same_id');
      expect(code1).toBe(code2);
    });

    it('should return empty string for empty requestId', () => {
      expect(deriveDeviceRequestCode('')).toBe('');
    });
  });

  describe('verifyAccess', () => {
    it('should throw BadRequestException when deviceId is missing or empty', async () => {
      await expect(service.verifyAccess({ deviceId: '' })).rejects.toThrow(BadRequestException);
      await expect(service.verifyAccess({ deviceId: undefined })).rejects.toThrow(
        BadRequestException
      );
      await expect(service.verifyAccess(undefined)).rejects.toThrow(BadRequestException);
    });

    it('should throw Error if prisma is unavailable', async () => {
      await expect(service.verifyAccess({ deviceId: 'dev_1' })).rejects.toThrow(
        'Database service unavailable'
      );
    });

    it('should throw UnauthorizedException if device is not in allowlist', async () => {
      mockPrisma.catcastDevice.findUnique.mockResolvedValue(null);

      await expect(dbService.verifyAccess({ deviceId: 'dev_unknown' })).rejects.toThrow(
        UnauthorizedException
      );
      expect(mockPrisma.catcastDevice.findUnique).toHaveBeenCalledWith({
        where: { deviceId: 'dev_unknown' },
      });
    });

    it('should throw UnauthorizedException if device is in allowlist but isAllowed is false', async () => {
      mockPrisma.catcastDevice.findUnique.mockResolvedValue({
        id: 1,
        deviceId: 'dev_blocked',
        isAllowed: false,
      });

      await expect(dbService.verifyAccess({ deviceId: 'dev_blocked' })).rejects.toThrow(
        UnauthorizedException
      );
    });

    it('should return success and device info when device is allowed', async () => {
      mockPrisma.catcastDevice.findUnique.mockResolvedValue({
        id: 1,
        deviceId: 'android_dev_1',
        platform: 'android_tv',
        isAllowed: true,
      });

      const res = await dbService.verifyAccess({
        deviceId: 'android_dev_1',
        platform: 'android_tv',
      });
      expect(res).toEqual({
        success: true,
        deviceId: 'android_dev_1',
        boundDeviceId: 'android_dev_1',
        platform: 'android_tv',
      });
    });

    it('should default platform to web if not provided in device or dto', async () => {
      mockPrisma.catcastDevice.findUnique.mockResolvedValue({
        id: 2,
        deviceId: 'web_dev_2',
        platform: '',
        isAllowed: true,
      });

      const res = await dbService.verifyAccess({ deviceId: 'web_dev_2' });
      expect(res.platform).toBe('web');
    });
  });

  describe('Device Access Management', () => {
    it('should throw BadRequestException if deviceId is missing in requestDeviceAccess', async () => {
      await expect(
        dbService.requestDeviceAccess({ deviceId: '', platform: 'android_tv' })
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw Error if prisma is unavailable in requestDeviceAccess', async () => {
      await expect(service.requestDeviceAccess({ deviceId: 'dev_1', platform: 'web' })).rejects.toThrow(
        'Database service unavailable'
      );
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
      expect(res.code).toBe(deriveDeviceRequestCode('req_existing_123'));
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
      expect(res.code).toBe(deriveDeviceRequestCode('req_new_456'));
      expect(mockNotifier).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'req_new_456',
          code: deriveDeviceRequestCode('req_new_456'),
        })
      );
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
      expect(res.code).toBe(deriveDeviceRequestCode('req_new_789'));
      expect(mockFaultyNotifier).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'req_new_789',
          code: deriveDeviceRequestCode('req_new_789'),
        })
      );
    });

    describe('getDeviceStatus', () => {
      it('should return unknown if deviceId is empty or no requests found', async () => {
        expect(await dbService.getDeviceStatus('')).toEqual({
          status: 'unknown',
          code: null,
          expiresAt: null,
          requestId: null,
        });

        mockPrisma.catcastDevice.findUnique.mockResolvedValue(null);
        mockPrisma.catcastDeviceRequest.findFirst.mockResolvedValue(null);

        expect(await dbService.getDeviceStatus('dev-unknown')).toEqual({
          status: 'unknown',
          code: null,
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
        expect(res.code).toBeNull();
      });

      it('should return pending and derived code if request is active', async () => {
        mockPrisma.catcastDevice.findUnique.mockResolvedValue(null);
        const futureExpires = new Date(Date.now() + 15 * 60 * 1000);
        mockPrisma.catcastDeviceRequest.findFirst.mockResolvedValue({
          id: 'req_1',
          status: 'pending',
          expiresAt: futureExpires,
        });

        const res = await dbService.getDeviceStatus('dev_pending');
        expect(res.status).toBe('pending');
        expect(res.code).toBe(deriveDeviceRequestCode('req_1'));
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
        expect(res.code).toBeNull();
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
        expect(res.code).toBeNull();
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

        mockPrisma.catcastDevice.findUnique.mockRejectedValueOnce(
          new Error('Table CatcastDevice does not exist')
        );
        const errRes = await dbService.getDeviceStatus('dev_db_err');
        expect(errRes.status).toBe('unknown');

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
