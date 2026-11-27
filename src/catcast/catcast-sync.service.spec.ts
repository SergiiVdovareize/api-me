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
    city: null,
    country: null,
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
        updateMany: jest.fn(),
      },
      catcastProfile: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
      },
      catcastSyncHistory: {
        findMany: jest.fn(),
        create: jest.fn(),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      catcastSyncFavorite: {
        findMany: jest.fn(),
        create: jest.fn(),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
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

      const initRes = await service.pairInit(ctxA, {});
      expect(initRes.code).toHaveLength(6);
      expect(initRes.pairSecret).toHaveLength(64);

      const confirmRes = await service.pairConfirm(
        { code: initRes.code, deviceId: 'dev-b' },
        '10.0.0.1'
      );
      expect(confirmRes.status).toBe('pending_accept');
      expect(confirmRes.pairSecret).toBe(initRes.pairSecret);
      expect(confirmRes.targetDevice.label).toBe('My iPhone (iOS, Safari)');

      const statusPendingAccept = await service.pairStatus(
        initRes.code,
        initRes.pairSecret,
        '10.0.0.1',
        'host'
      );
      expect(statusPendingAccept.status).toBe('pending_accept');
      expect((statusPendingAccept as any).peerDevice.label).toContain('Samsung TV');

      const acceptRes = await service.pairAccept(ctxA, {
        code: initRes.code,
        pairSecret: initRes.pairSecret,
        accept: true,
      });
      expect(acceptRes.status).toBe('confirmed');
      expect(notifier).toHaveBeenCalledTimes(1);

      // Host polling with role=host does not consume joiner's syncToken
      const hostConfirmed = await service.pairStatus(
        initRes.code,
        initRes.pairSecret,
        '10.0.0.1',
        'host'
      );
      expect(hostConfirmed.status).toBe('confirmed');
      expect((hostConfirmed as any).syncToken).toBeUndefined();

      // Joiner picks up syncToken once
      const statusConfirmed = await service.pairStatus(
        initRes.code,
        initRes.pairSecret,
        '10.0.0.1',
        'joiner'
      );
      expect(statusConfirmed.status).toBe('confirmed');
      expect((statusConfirmed as any).profileId).toBe('prof-a');
      expect((statusConfirmed as any).syncToken).toHaveLength(64);

      // Subsequent poll after one-time pickup should be expired
      const statusAfterPickup = await service.pairStatus(
        initRes.code,
        initRes.pairSecret,
        '10.0.0.1'
      );
      expect(statusAfterPickup.status).toBe('expired');
    });

    it('rejects pairing when host device declines', async () => {
      mockPrisma.catcastDevice.findUnique.mockResolvedValue({
        id: 2,
        deviceId: 'dev-b',
        platform: 'web',
        isAllowed: true,
      });

      const initRes = await service.pairInit(ctxA, {});
      await service.pairConfirm({ code: initRes.code, deviceId: 'dev-b' }, '10.0.0.1');

      const rejectRes = await service.pairAccept(ctxA, {
        code: initRes.code,
        pairSecret: initRes.pairSecret,
        accept: false,
      });
      expect(rejectRes.status).toBe('rejected');

      const status = await service.pairStatus(initRes.code, initRes.pairSecret, '10.0.0.1');
      expect(status.status).toBe('rejected');
    });

    it('blocks brute-force attempts on pairConfirm', async () => {
      for (let i = 0; i < 5; i++) {
        await expect(
          service.pairConfirm({ code: 'BADCOD', deviceId: 'dev-b' }, '10.0.0.1')
        ).rejects.toThrow(NotFoundException);
      }

      await expect(
        service.pairConfirm({ code: 'BADCOD', deviceId: 'dev-b' }, '10.0.0.1')
      ).rejects.toThrow(HttpException);
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

      const initRes = await service.pairInit(ctxA, { deviceName: 'Updated Host' });
      expect(mockPrisma.catcastDevice.update).toHaveBeenCalled();

      const pendingStatus = await service.pairStatus(initRes.code, initRes.pairSecret, '10.0.0.2');
      expect(pendingStatus.status).toBe('pending');

      await expect(service.pairStatus(initRes.code, 'wrong-secret', '10.0.0.2')).rejects.toThrow(
        UnauthorizedException
      );
      await expect(service.pairStatus('', '', '10.0.0.2')).rejects.toThrow(BadRequestException);

      // Self-pairing rejected (joiner deviceId == host deviceId)
      mockPrisma.catcastDevice.findUnique.mockResolvedValueOnce({
        id: 1,
        deviceId: 'dev-a',
        platform: 'mobile_web',
        isAllowed: true,
      });
      await expect(
        service.pairConfirm({ code: initRes.code, deviceId: 'dev-a' }, '10.0.0.2')
      ).rejects.toThrow(BadRequestException);

      // Confirm once, then idempotent confirm from same joiner, then reject different joiner
      mockPrisma.catcastDevice.findUnique.mockResolvedValue({
        id: 2,
        deviceId: 'dev-b',
        platform: 'web',
        isAllowed: true,
      });
      await service.pairConfirm(
        { code: initRes.code, deviceId: 'dev-b', deviceName: 'My TV', browser: 'Tizen' },
        '10.0.0.2'
      );
      const idempotentConfirm = await service.pairConfirm(
        { code: initRes.code, deviceId: 'dev-b' },
        '10.0.0.2'
      );
      expect(idempotentConfirm.status).toBe('pending_accept');

      mockPrisma.catcastDevice.findUnique.mockResolvedValueOnce({
        id: 3,
        deviceId: 'dev-other',
        platform: 'web',
        isAllowed: true,
      });
      await expect(
        service.pairConfirm({ code: initRes.code, deviceId: 'dev-other' }, '10.0.0.2')
      ).rejects.toThrow(BadRequestException);
    });

    it('handles pairAccept edge cases (expired, wrong host, invalid secret, wrong state, idempotent confirmed)', async () => {
      await expect(
        service.pairAccept(ctxA, { code: 'NONE12', pairSecret: 'sec', accept: true })
      ).rejects.toThrow(NotFoundException);

      mockPrisma.catcastDevice.findUnique.mockResolvedValue({
        id: 2,
        deviceId: 'dev-b',
        platform: 'web',
        isAllowed: true,
      });
      const initRes = await service.pairInit(ctxA, {});

      // Non-host device cannot accept
      await expect(
        service.pairAccept(
          { ...ctxA, deviceId: 'dev-other' },
          { code: initRes.code, pairSecret: initRes.pairSecret, accept: true }
        )
      ).rejects.toThrow(UnauthorizedException);

      await expect(
        service.pairAccept(ctxA, { code: initRes.code, pairSecret: 'bad', accept: true })
      ).rejects.toThrow(UnauthorizedException);

      // Still pending -> cannot accept yet
      await expect(
        service.pairAccept(ctxA, {
          code: initRes.code,
          pairSecret: initRes.pairSecret,
          accept: true,
        })
      ).rejects.toThrow(BadRequestException);

      await service.pairConfirm({ code: initRes.code, deviceId: 'dev-b' }, '10.0.0.3');
      service.setDevicePairedNotifier(jest.fn().mockRejectedValue(new Error('tg down')));

      const first = await service.pairAccept(ctxA, {
        code: initRes.code,
        pairSecret: initRes.pairSecret,
        accept: true,
      });
      expect(first.status).toBe('confirmed');

      const second = await service.pairAccept(ctxA, {
        code: initRes.code,
        pairSecret: initRes.pairSecret,
        accept: true,
      });
      expect(second.status).toBe('confirmed');
    });

    it('merges entire source profile (all devices + history + favorites + search) into host profile on pairAccept', async () => {
      mockPrisma.catcastDevice.findUnique.mockResolvedValue({
        id: 2,
        deviceId: 'dev-b',
        platform: 'desktop_web',
        profileId: 'prof-b',
        isAllowed: true,
      });
      mockPrisma.catcastProfile.findUnique
        .mockResolvedValueOnce({
          id: 'prof-a',
          historyClearedTs: BigInt(100),
          searchQueries: ['old'],
          searchUpdatedAt: BigInt(100),
        })
        .mockResolvedValueOnce({
          id: 'prof-b',
          historyClearedTs: BigInt(200),
          searchQueries: ['newer'],
          searchUpdatedAt: BigInt(500),
        });
      mockPrisma.catcastSyncHistory.findMany
        .mockResolvedValueOnce([
          {
            mediaKey: '/films/b',
            url: '/films/b',
            canonicalId: 'b',
            title: 'From B',
            orig: '',
            poster: '',
            season: null,
            episode: null,
            episodeName: '',
            currentTime: 50,
            duration: 100,
            completed: false,
            watchedEpisodes: {},
            voice: '',
            ts: BigInt(1000),
          },
        ])
        .mockResolvedValueOnce([]) // existing in prof-a
        .mockResolvedValueOnce([]); // overflow check
      mockPrisma.catcastSyncFavorite.findMany
        .mockResolvedValueOnce([
          {
            mediaKey: '/films/fav-b',
            url: '/films/fav-b',
            canonicalId: 'fb',
            title: 'Fav B',
            orig: '',
            poster: '',
            ts: BigInt(1000),
            deletedAt: null,
          },
        ])
        .mockResolvedValueOnce([]) // existing in prof-a
        .mockResolvedValueOnce([]); // overflow check
      mockPrisma.catcastDevice.updateMany.mockResolvedValue({ count: 2 });
      mockPrisma.catcastDevice.update.mockResolvedValue({});
      mockPrisma.catcastProfile.delete.mockResolvedValue({});

      const initRes = await service.pairInit(ctxA, {});
      await service.pairConfirm({ code: initRes.code, deviceId: 'dev-b' }, '10.0.0.4');
      const res = await service.pairAccept(ctxA, {
        code: initRes.code,
        pairSecret: initRes.pairSecret,
        accept: true,
      });

      expect(res.status).toBe('confirmed');
      const statusRes = await service.pairStatus(initRes.code, initRes.pairSecret, '10.0.0.4');
      expect((statusRes as any).profileId).toBe('prof-a');
      expect(mockPrisma.catcastDevice.updateMany).toHaveBeenCalledWith({
        where: { profileId: 'prof-b' },
        data: { profileId: 'prof-a' },
      });
      expect(mockPrisma.catcastSyncHistory.createMany).toHaveBeenCalled();
      expect(mockPrisma.catcastSyncFavorite.createMany).toHaveBeenCalled();
      expect(mockPrisma.catcastProfile.delete).toHaveBeenCalledWith({
        where: { id: 'prof-b' },
      });
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

    it('updates device city/country/browser on push and returns location in listDevices', async () => {
      mockPrisma.catcastDevice.update.mockResolvedValue({});
      mockPrisma.catcastProfile.findUnique.mockResolvedValue({
        id: 'prof-a',
        historyClearedTs: BigInt(0),
        searchQueries: [],
        searchUpdatedAt: BigInt(0),
      });

      await service.push(ctxA, {}, { city: 'Kyiv', country: 'UA', browser: 'Chrome 131' });
      expect(mockPrisma.catcastDevice.update).toHaveBeenCalledWith({
        where: { deviceId: 'dev-a' },
        data: { city: 'Kyiv', country: 'UA', browser: 'Chrome 131' },
      });

      mockPrisma.catcastDevice.findMany.mockResolvedValue([
        {
          deviceId: 'dev-a',
          deviceName: 'Phone',
          platform: 'mobile_web',
          model: 'iPhone',
          os: 'iOS',
          browser: 'Chrome 131',
          city: 'Kyiv',
          country: 'UA',
          syncLastSeenAt: null,
        },
      ]);

      const devicesRes = await service.listDevices(ctxA);
      expect(devicesRes.devices[0]).toMatchObject({
        city: 'Kyiv',
        country: 'UA',
        location: 'Kyiv, UA',
      });
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
      expect(mockPrisma.catcastSyncHistory.createMany).toHaveBeenCalled();
      expect(mockPrisma.catcastSyncHistory.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: [999] } },
      });
      expect(mockPrisma.catcastSyncFavorite.createMany).toHaveBeenCalled();
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
      expect(mockPrisma.catcastSyncHistory.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({
              season: 1,
              episode: 3,
              currentTime: 12,
              duration: 1346,
            }),
          ],
          skipDuplicates: true,
        })
      );
    });

    it('deduplicates repeated mediaKeys in same push and updates existing favorites', async () => {
      mockPrisma.catcastProfile.findUnique.mockResolvedValue({
        id: 'prof-a',
        historyClearedTs: BigInt(0),
        searchQueries: [],
        searchUpdatedAt: BigInt(0),
      });
      mockPrisma.catcastSyncHistory.findMany.mockResolvedValue([]);
      mockPrisma.catcastSyncFavorite.findMany
        .mockResolvedValueOnce([
          {
            id: 10,
            mediaKey: '/films/old-fav',
            url: '/films/old-fav',
            canonicalId: '10',
            title: 'Old Fav',
            orig: '',
            poster: '',
            ts: BigInt(1000),
            deletedAt: null,
          },
        ])
        .mockResolvedValueOnce([]); // overflow
      mockPrisma.catcastSyncFavorite.update.mockResolvedValue({});

      await service.push(ctxA, {
        history: [
          {
            mediaKey: '/films/dup',
            title: 'Older',
            watchedEpisodes: { '1:1': 1000 },
            ts: 1000,
          },
          {
            mediaKey: '/films/dup',
            title: 'Newer',
            watchedEpisodes: { '1:2': 2000 },
            ts: 2000,
          },
        ],
        favorites: [
          { mediaKey: '/films/dup-fav', title: 'First', ts: 1000 },
          { mediaKey: '/films/dup-fav', title: 'Second', ts: 2000, deletedAt: 2500 },
          { mediaKey: '/films/old-fav', title: 'Old Fav', ts: 1000, deletedAt: 3000 },
        ],
      });

      expect(mockPrisma.catcastSyncHistory.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({
              mediaKey: '/films/dup',
              title: 'Newer',
              watchedEpisodes: { '1:1': 1000, '1:2': 2000 },
            }),
          ],
        })
      );
      expect(mockPrisma.catcastSyncFavorite.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 10 },
          data: expect.objectContaining({ deletedAt: BigInt(3000) }),
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
