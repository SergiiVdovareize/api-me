import {
  BadRequestException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CatcastSyncService, buildDeviceLabel } from './catcast-sync.service';
import { PrismaService } from '../models/prisma/prisma.service';
import { RedisReader } from '../common/helpers/redisReader';
import { CatcastSyncContext } from './catcast-sync.guard';

describe('CatcastSyncService', () => {
  let service: CatcastSyncService;
  let mockPrisma: any;
  let mockRedisStore: Map<string, any>;
  let mockRedis: any;
  let mockRedisReader: any;

  const ctxA: CatcastSyncContext = {
    profileId: 'prof-a',
    deviceId: 'dev-a',
    platform: 'mobile_web',
    model: 'iPhone',
    os: 'iOS',
    browser: 'Safari',
    deviceName: 'My iPhone',
  };

  beforeEach(async () => {
    mockRedisStore = new Map();
    mockRedis = {
      incr: jest.fn(async (key: string) => {
        const next = Number(mockRedisStore.get(key) || 0) + 1;
        mockRedisStore.set(key, next);
        return next;
      }),
      expire: jest.fn().mockResolvedValue(1),
      get: jest.fn(async (key: string) => mockRedisStore.get(key) ?? null),
    };

    mockRedisReader = {
      redis: mockRedis,
      read: jest.fn(async (key: string) => mockRedisStore.get(key) ?? null),
      write: jest.fn(async (key: string, val: any) => {
        mockRedisStore.set(key, val);
        return 'OK';
      }),
      delete: jest.fn(async (key: string) => {
        mockRedisStore.delete(key);
        return 1;
      }),
    };

    mockPrisma = {
      catcastDevice: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      catcastProfile: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      catcastSyncHistory: {
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      catcastSyncFavorite: {
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(async (cb: any) => cb(mockPrisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CatcastSyncService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RedisReader, useValue: mockRedisReader },
      ],
    }).compile();

    service = module.get<CatcastSyncService>(CatcastSyncService);
  });

  describe('buildDeviceLabel', () => {
    it('formats human-readable label with os and browser', () => {
      expect(
        buildDeviceLabel({
          deviceName: 'MacBook Pro',
          platform: 'desktop_web',
          os: 'macOS',
          browser: 'Chrome',
        })
      ).toBe('MacBook Pro (macOS, Chrome)');
    });
  });

  describe('initProfile', () => {
    it('rejects unapproved device', async () => {
      mockPrisma.catcastDevice.findUnique.mockResolvedValue({
        id: 1,
        deviceId: 'dev-1',
        isAllowed: false,
      });

      await expect(service.initProfile({ deviceId: 'dev-1' }, '127.0.0.1')).rejects.toThrow(
        UnauthorizedException
      );
    });

    it('creates new profile for allowed device without profileId', async () => {
      mockPrisma.catcastDevice.findUnique.mockResolvedValue({
        id: 1,
        deviceId: 'dev-1',
        platform: 'web',
        isAllowed: true,
        profileId: null,
      });
      mockPrisma.catcastProfile.create.mockResolvedValue({ id: 'prof-new' });
      mockPrisma.catcastDevice.update.mockResolvedValue({});

      const res = await service.initProfile(
        { deviceId: 'dev-1', deviceName: 'Laptop', browser: 'Chrome' },
        '127.0.0.1'
      );

      expect(res.profileId).toBe('prof-new');
      expect(res.syncToken).toHaveLength(64);
      expect(mockPrisma.catcastDevice.update).toHaveBeenCalled();
    });
  });

  describe('pairing flow (mutual confirmation)', () => {
    it('completes full pairing flow: init -> confirm -> status -> accept -> status', async () => {
      const notifier = jest.fn().mockResolvedValue(undefined);
      service.setDevicePairedNotifier(notifier);

      mockPrisma.catcastDevice.findUnique.mockResolvedValue({
        id: 2,
        deviceId: 'dev-b',
        platform: 'tizen_tv',
        model: 'Samsung TV',
        os: 'Tizen',
        browser: null,
        deviceName: null,
        isAllowed: true,
      });
      mockPrisma.catcastDevice.update.mockResolvedValue({});

      const initRes = await service.pairInit({ deviceId: 'dev-b' }, '10.0.0.1');
      expect(initRes.code).toHaveLength(6);
      expect(initRes.pairSecret).toHaveLength(64);

      const confirmRes = await service.pairConfirm(ctxA, { code: initRes.code });
      expect(confirmRes.status).toBe('awaiting_acceptance');
      expect(confirmRes.targetDevice.label).toContain('Samsung TV');

      const statusAwaiting = await service.pairStatus(initRes.code, initRes.pairSecret, '10.0.0.1');
      expect(statusAwaiting.status).toBe('awaiting_acceptance');
      expect((statusAwaiting as any).peerDevice.label).toBe('My iPhone (iOS, Safari)');

      const acceptRes = await service.pairAccept(
        { code: initRes.code, pairSecret: initRes.pairSecret, accept: true },
        '10.0.0.1'
      );
      expect(acceptRes.status).toBe('confirmed');
      expect(acceptRes.profileId).toBe('prof-a');
      expect(acceptRes.syncToken).toHaveLength(64);
      expect(notifier).toHaveBeenCalledTimes(1);

      const statusConfirmed = await service.pairStatus(
        initRes.code,
        initRes.pairSecret,
        '10.0.0.1'
      );
      expect(statusConfirmed.status).toBe('confirmed');

      // Subsequent poll after one-time pickup should be expired
      const statusAfterPickup = await service.pairStatus(
        initRes.code,
        initRes.pairSecret,
        '10.0.0.1'
      );
      expect(statusAfterPickup.status).toBe('expired');
    });

    it('rejects pairing when target device declines', async () => {
      mockPrisma.catcastDevice.findUnique.mockResolvedValue({
        id: 2,
        deviceId: 'dev-b',
        platform: 'web',
        isAllowed: true,
      });

      const initRes = await service.pairInit({ deviceId: 'dev-b' }, '10.0.0.1');
      await service.pairConfirm(ctxA, { code: initRes.code });

      const rejectRes = await service.pairAccept(
        { code: initRes.code, pairSecret: initRes.pairSecret, accept: false },
        '10.0.0.1'
      );
      expect(rejectRes.status).toBe('rejected');

      const status = await service.pairStatus(initRes.code, initRes.pairSecret, '10.0.0.1');
      expect(status.status).toBe('rejected');
    });

    it('blocks brute-force attempts on pairConfirm', async () => {
      for (let i = 0; i < 5; i++) {
        await expect(service.pairConfirm(ctxA, { code: 'BADCOD' })).rejects.toThrow(
          NotFoundException
        );
      }

      await expect(service.pairConfirm(ctxA, { code: 'BADCOD' })).rejects.toThrow(HttpException);
    });
  });

  describe('removeDevice (unlink vs revoke)', () => {
    it('unlinks device without revoking allowlist access', async () => {
      mockPrisma.catcastDevice.findFirst.mockResolvedValue({
        id: 2,
        deviceId: 'dev-b',
        profileId: 'prof-a',
      });
      mockPrisma.catcastDevice.update.mockResolvedValue({});

      const res = await service.removeDevice(ctxA, 'dev-b', 'unlink');
      expect(res).toEqual({ success: true, deviceId: 'dev-b', mode: 'unlink' });
      expect(mockPrisma.catcastDevice.update).toHaveBeenCalledWith({
        where: { id: 2 },
        data: { profileId: null, syncTokenHash: null },
      });
    });

    it('revokes device allowlist access when mode is revoke', async () => {
      mockPrisma.catcastDevice.findFirst.mockResolvedValue({
        id: 2,
        deviceId: 'dev-b',
        profileId: 'prof-a',
      });
      mockPrisma.catcastDevice.update.mockResolvedValue({});

      const res = await service.removeDevice(ctxA, 'dev-b', 'revoke');
      expect(res).toEqual({ success: true, deviceId: 'dev-b', mode: 'revoke' });
      expect(mockPrisma.catcastDevice.update).toHaveBeenCalledWith({
        where: { id: 2 },
        data: { profileId: null, syncTokenHash: null, isAllowed: false },
      });
    });

    it('prevents revoking the currently active device', async () => {
      await expect(service.removeDevice(ctxA, 'dev-a', 'revoke')).rejects.toThrow(
        BadRequestException
      );
    });
  });

  describe('push & pull merge logic', () => {
    it('merges watchedEpisodes per-episode and respects historyClearedTs', async () => {
      mockPrisma.catcastProfile.findUnique.mockResolvedValue({
        id: 'prof-a',
        historyClearedTs: BigInt(1000),
        searchQueries: [],
        searchUpdatedAt: BigInt(0),
      });
      mockPrisma.catcastSyncHistory.findMany
        .mockResolvedValueOnce([
          {
            id: 1,
            mediaKey: '/serials/1',
            url: '/serials/1',
            canonicalId: '1',
            title: 'Show',
            orig: '',
            poster: '',
            season: 1,
            episode: 2,
            episodeName: 'Ep 2',
            currentTime: 300,
            duration: 1200,
            completed: false,
            voice: 'UA',
            watchedEpisodes: { '1:1': 2000, '1:2': 2500 },
            ts: BigInt(2500),
          },
        ])
        .mockResolvedValueOnce([]); // overflow check

      mockPrisma.catcastSyncHistory.update.mockResolvedValue({});

      const res = await service.push(ctxA, {
        history: [
          {
            mediaKey: '/films/old',
            ts: 900, // <= historyClearedTs (1000), should be ignored
          },
          {
            mediaKey: '/serials/1',
            season: 1,
            episode: 3,
            currentTime: 100,
            watchedEpisodes: { '1:1': 1500, '1:3': 3000 },
            ts: 3000,
          },
        ],
      });

      expect(res.serverTs).toBeGreaterThan(0);
      expect(mockPrisma.catcastSyncHistory.create).not.toHaveBeenCalled();
      expect(mockPrisma.catcastSyncHistory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({
            season: 1,
            episode: 3,
            currentTime: 100,
            watchedEpisodes: { '1:1': 2000, '1:2': 2500, '1:3': 3000 },
          }),
        })
      );
    });

    it('pulls delta since serverTs including deleted favorites', async () => {
      mockPrisma.catcastProfile.findUnique.mockResolvedValue({
        id: 'prof-a',
        historyClearedTs: BigInt(1000),
        searchQueries: ['офіс'],
        searchUpdatedAt: BigInt(5000),
      });
      mockPrisma.catcastSyncHistory.findMany.mockResolvedValue([]);
      mockPrisma.catcastSyncFavorite.findMany.mockResolvedValue([
        {
          mediaKey: '/films/2',
          url: '/films/2',
          canonicalId: '2',
          title: 'Movie',
          orig: '',
          poster: '',
          ts: BigInt(3000),
          deletedAt: BigInt(4500),
          updatedOnServerAt: BigInt(4600),
        },
      ]);

      const res = await service.pull(ctxA, '4000');
      expect(res.serverTs).toBe(4600);
      expect(res.favorites).toHaveLength(1);
      expect(res.favorites[0].deletedAt).toBe(4500);
      expect(res.searchHistory).toEqual({ queries: ['офіс'], updatedAt: 5000 });
    });
  });

  describe('cleanupExpiredData', () => {
    it('deletes expired tombstones and orphan profiles', async () => {
      mockPrisma.catcastSyncFavorite.deleteMany.mockResolvedValue({ count: 3 });
      mockPrisma.catcastProfile.deleteMany.mockResolvedValue({ count: 1 });

      const res = await service.cleanupExpiredData();
      expect(res).toEqual({ deletedTombstones: 3, deletedOrphanProfiles: 1 });
    });
  });
});
