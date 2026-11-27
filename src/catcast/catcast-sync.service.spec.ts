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

    it('re-issues syncToken when device already has profileId and rejects empty deviceId', async () => {
      await expect(service.initProfile({ deviceId: '   ' }, '127.0.0.1')).rejects.toThrow(
        BadRequestException
      );

      mockPrisma.catcastDevice.findUnique.mockResolvedValue({
        id: 1,
        deviceId: 'dev-1',
        platform: 'web',
        isAllowed: true,
        profileId: 'prof-existing',
        deviceName: 'Old',
        browser: 'Firefox',
      });
      mockPrisma.catcastDevice.update.mockResolvedValue({});

      const res = await service.initProfile({ deviceId: 'dev-1' }, '127.0.0.1');
      expect(res.profileId).toBe('prof-existing');
      expect(res.syncToken).toHaveLength(64);
    });

    it('enforces rate limit on initProfile', async () => {
      mockPrisma.catcastDevice.findUnique.mockResolvedValue({
        id: 1,
        deviceId: 'dev-rl',
        platform: 'web',
        isAllowed: true,
        profileId: 'prof-1',
      });
      mockPrisma.catcastDevice.update.mockResolvedValue({});

      for (let i = 0; i < 10; i++) {
        await service.initProfile({ deviceId: 'dev-rl' }, '10.10.10.10');
      }
      await expect(service.initProfile({ deviceId: 'dev-rl' }, '10.10.10.10')).rejects.toThrow(
        HttpException
      );
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

    it('handles pairInit metadata update, pairStatus pending/invalid secret, and pairConfirm edge cases', async () => {
      mockPrisma.catcastDevice.findUnique.mockResolvedValue({
        id: 2,
        deviceId: 'dev-b',
        platform: 'web',
        model: null,
        os: null,
        browser: null,
        deviceName: null,
        isAllowed: true,
      });
      mockPrisma.catcastDevice.update.mockResolvedValue({});

      const initRes = await service.pairInit(
        { deviceId: 'dev-b', deviceName: 'My TV', browser: 'Tizen' },
        '10.0.0.2'
      );
      expect(mockPrisma.catcastDevice.update).toHaveBeenCalledWith({
        where: { id: 2 },
        data: { deviceName: 'My TV', browser: 'Tizen' },
      });

      const pendingStatus = await service.pairStatus(initRes.code, initRes.pairSecret, '10.0.0.2');
      expect(pendingStatus.status).toBe('pending');

      await expect(service.pairStatus(initRes.code, 'wrong-secret', '10.0.0.2')).rejects.toThrow(
        UnauthorizedException
      );
      await expect(service.pairStatus('', '', '10.0.0.2')).rejects.toThrow(BadRequestException);

      // Self-pairing rejected
      await expect(
        service.pairConfirm({ ...ctxA, deviceId: 'dev-b' }, { code: initRes.code })
      ).rejects.toThrow(BadRequestException);

      // Confirm once, then idempotent confirm from same initiator, then reject different initiator
      await service.pairConfirm(ctxA, { code: initRes.code });
      const idempotentConfirm = await service.pairConfirm(ctxA, { code: initRes.code });
      expect(idempotentConfirm.status).toBe('awaiting_acceptance');

      await expect(
        service.pairConfirm({ ...ctxA, deviceId: 'dev-other' }, { code: initRes.code })
      ).rejects.toThrow(BadRequestException);
    });

    it('handles pairAccept edge cases (expired, invalid secret, wrong state, idempotent confirmed)', async () => {
      await expect(
        service.pairAccept({ code: 'NONE12', pairSecret: 'sec', accept: true }, '10.0.0.3')
      ).rejects.toThrow(NotFoundException);

      mockPrisma.catcastDevice.findUnique.mockResolvedValue({
        id: 2,
        deviceId: 'dev-b',
        platform: 'web',
        isAllowed: true,
      });
      const initRes = await service.pairInit({ deviceId: 'dev-b' }, '10.0.0.3');

      await expect(
        service.pairAccept({ code: initRes.code, pairSecret: 'bad', accept: true }, '10.0.0.3')
      ).rejects.toThrow(UnauthorizedException);

      // Still pending -> cannot accept yet
      await expect(
        service.pairAccept(
          { code: initRes.code, pairSecret: initRes.pairSecret, accept: true },
          '10.0.0.3'
        )
      ).rejects.toThrow(BadRequestException);

      await service.pairConfirm(ctxA, { code: initRes.code });
      service.setDevicePairedNotifier(jest.fn().mockRejectedValue(new Error('tg down')));

      const first = await service.pairAccept(
        { code: initRes.code, pairSecret: initRes.pairSecret, accept: true },
        '10.0.0.3'
      );
      expect(first.status).toBe('confirmed');

      const second = await service.pairAccept(
        { code: initRes.code, pairSecret: initRes.pairSecret, accept: true },
        '10.0.0.3'
      );
      expect(second.status).toBe('confirmed');
    });
  });

  describe('listDevices & removeDevice edge cases', () => {
    it('lists devices with isCurrent flag', async () => {
      const now = new Date();
      mockPrisma.catcastDevice.findMany.mockResolvedValue([
        {
          deviceId: 'dev-a',
          deviceName: 'Phone',
          platform: 'mobile_web',
          model: 'iPhone',
          os: 'iOS',
          browser: 'Safari',
          syncLastSeenAt: now,
        },
        {
          deviceId: 'dev-b',
          deviceName: null,
          platform: 'tizen_tv',
          model: 'Samsung TV',
          os: null,
          browser: null,
          syncLastSeenAt: null,
        },
      ]);

      const res = await service.listDevices(ctxA);
      expect(res.devices).toHaveLength(2);
      expect(res.devices[0].isCurrent).toBe(true);
      expect(res.devices[1].isCurrent).toBe(false);
      expect(res.devices[1].syncLastSeenAt).toBeNull();
    });

    it('throws on empty deviceId or missing device', async () => {
      await expect(service.removeDevice(ctxA, '')).rejects.toThrow(BadRequestException);
      mockPrisma.catcastDevice.findFirst.mockResolvedValue(null);
      await expect(service.removeDevice(ctxA, 'missing')).rejects.toThrow(NotFoundException);
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

    it('creates new history, favorites, clears history, updates searchHistory, and trims overflow', async () => {
      mockPrisma.catcastProfile.findUnique.mockResolvedValue({
        id: 'prof-a',
        historyClearedTs: BigInt(500),
        searchQueries: [],
        searchUpdatedAt: BigInt(100),
      });
      mockPrisma.catcastSyncHistory.findMany
        .mockResolvedValueOnce([]) // existing
        .mockResolvedValueOnce([{ id: 999 }]); // overflow > 200
      mockPrisma.catcastSyncFavorite.findMany
        .mockResolvedValueOnce([]) // existing
        .mockResolvedValueOnce([{ id: 888 }]); // overflow > 500

      await service.push(ctxA, {
        historyClearedTs: 1000,
        history: [{ mediaKey: '/films/new', title: 'New Film', ts: 2000 }],
        favorites: [{ mediaKey: '/films/fav', title: 'Fav', ts: 2000 }],
        searchHistory: { queries: ['ok', 'valid query'], updatedAt: 3000 },
      });

      expect(mockPrisma.catcastProfile.update).toHaveBeenCalledWith({
        where: { id: 'prof-a' },
        data: { historyClearedTs: BigInt(1000) },
      });
      expect(mockPrisma.catcastSyncHistory.create).toHaveBeenCalled();
      expect(mockPrisma.catcastSyncHistory.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: [999] } },
      });
      expect(mockPrisma.catcastSyncFavorite.create).toHaveBeenCalled();
      expect(mockPrisma.catcastSyncFavorite.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: [888] } },
      });
      expect(mockPrisma.catcastProfile.update).toHaveBeenCalledWith({
        where: { id: 'prof-a' },
        data: { searchQueries: ['valid query'], searchUpdatedAt: BigInt(3000) },
      });
    });

    it('rejects oversized push payloads and missing profile', async () => {
      const tooManyHistory = Array.from({ length: 201 }, (_, i) => ({
        mediaKey: `/f/${i}`,
        ts: 1000,
      }));
      await expect(service.push(ctxA, { history: tooManyHistory })).rejects.toThrow(
        BadRequestException
      );

      const tooManyFavs = Array.from({ length: 501 }, (_, i) => ({
        mediaKey: `/f/${i}`,
        ts: 1000,
      }));
      await expect(service.push(ctxA, { favorites: tooManyFavs })).rejects.toThrow(
        BadRequestException
      );

      mockPrisma.catcastProfile.findUnique.mockResolvedValue(null);
      await expect(service.push(ctxA, {})).rejects.toThrow(NotFoundException);
      await expect(service.pull(ctxA)).rejects.toThrow(NotFoundException);
    });

    it('pulls full state when since is 0', async () => {
      mockPrisma.catcastProfile.findUnique.mockResolvedValue({
        id: 'prof-a',
        historyClearedTs: BigInt(0),
        searchQueries: ['test'],
        searchUpdatedAt: BigInt(100),
      });
      mockPrisma.catcastSyncHistory.findMany.mockResolvedValue([
        {
          mediaKey: '/films/1',
          url: '/films/1',
          canonicalId: '1',
          title: 'One',
          orig: '',
          poster: '',
          season: null,
          episode: null,
          episodeName: '',
          currentTime: 10,
          duration: 100,
          completed: false,
          watchedEpisodes: {},
          voice: '',
          ts: BigInt(500),
          updatedOnServerAt: BigInt(600),
        },
      ]);
      mockPrisma.catcastSyncFavorite.findMany.mockResolvedValue([]);

      const res = await service.pull(ctxA);
      expect(res.serverTs).toBe(600);
      expect(res.history).toHaveLength(1);
    });

    it('normalizes string season ("Сезон 1") and float currentTime without 500 error', async () => {
      mockPrisma.catcastProfile.findUnique.mockResolvedValue({
        id: 'prof-a',
        historyClearedTs: BigInt(0),
        searchQueries: [],
        searchUpdatedAt: BigInt(0),
      });
      mockPrisma.catcastSyncHistory.findMany.mockResolvedValue([]);
      mockPrisma.catcastSyncHistory.create.mockResolvedValue({});

      const res = await service.push(ctxA, {
        history: [
          {
            mediaKey: '/7928',
            title: 'Офіс',
            season: 'Сезон 1' as any,
            episode: 3,
            currentTime: 12.75,
            duration: 1346.2,
            ts: 1795764718806,
          },
        ],
      });

      expect(res.serverTs).toBeGreaterThan(0);
      expect(mockPrisma.catcastSyncHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            season: 1,
            episode: 3,
            currentTime: 12,
            duration: 1346,
          }),
        })
      );
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
