import { Test, TestingModule } from '@nestjs/testing';
import { TrackService } from './track.service';
import { PrismaService } from 'src/prisma.service';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { RedisReader } from 'src/common/helpers/redisReader';
import { ConfigService } from '@nestjs/config';
import { AccountType } from 'src/models/enums/account-type.enum';
import { JarStatus } from './types';
import { promises as fs } from 'fs';

jest.mock('fs', () => {
  const actualFs = jest.requireActual('fs');
  return {
    ...actualFs,
    promises: {
      ...actualFs.promises,
      mkdir: jest.fn(),
      access: jest.fn(),
      writeFile: jest.fn(),
      readFile: jest.fn(),
    },
  };
});

describe('TrackService', () => {
  let service: TrackService;
  let prisma: any;
  let redisReader: any;
  let analyticsService: any;

  beforeEach(async () => {
    prisma = {
      account: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      accountIncoming: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
      },
    };

    redisReader = {
      delete: jest.fn(),
      read: jest.fn(),
      write: jest.fn(),
    };

    analyticsService = {
      trackApiEvent: jest.fn(),
      trackEvent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrackService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisReader, useValue: redisReader },
        { provide: AnalyticsService, useValue: analyticsService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('http://localhost') },
        },
      ],
    }).compile();

    service = module.get<TrackService>(TrackService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return default message', () => {
      expect(service.findAll()).toBe('This action returns all track');
    });
  });

  describe('cache invalidation', () => {
    it('should delete active accounts cache key', async () => {
      await service.invalidateCachedActiveAccounts();
      expect(redisReader.delete).toHaveBeenCalledWith(
        expect.stringContaining('active-track-accounts')
      );
    });

    it('should delete recent incoming cache key for specific account', async () => {
      await service.invalidateCacheRecentIncoming(123);
      expect(redisReader.delete).toHaveBeenCalledWith(
        expect.stringContaining('recent-incoming-123')
      );
    });
  });

  describe('date comparison helpers', () => {
    it('wasTwoWeeksAgo should identify dates correctly', () => {
      expect(service.wasTwoWeeksAgo(null as any)).toBe(false);

      const aWeekAgo = new Date();
      aWeekAgo.setDate(aWeekAgo.getDate() - 7);
      expect(service.wasTwoWeeksAgo(aWeekAgo)).toBe(false);

      const threeWeeksAgo = new Date();
      threeWeeksAgo.setDate(threeWeeksAgo.getDate() - 21);
      expect(service.wasTwoWeeksAgo(threeWeeksAgo)).toBe(true);
    });

    it('wasOneMonthAgo should identify dates correctly', () => {
      expect(service.wasOneMonthAgo(null as any)).toBe(false);

      const twoWeeksAgo = new Date();
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
      expect(service.wasOneMonthAgo(twoWeeksAgo)).toBe(false);

      const fiveWeeksAgo = new Date();
      fiveWeeksAgo.setDate(fiveWeeksAgo.getDate() - 35);
      expect(service.wasOneMonthAgo(fiveWeeksAgo)).toBe(true);
    });
  });

  describe('checkMono', () => {
    it('should return error if response is not ok', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({}),
      } as any);

      const result = await service.checkMono('test-id');
      expect(result).toEqual({ success: false, message: '400' });
      expect(fetchSpy).toHaveBeenCalled();
    });

    it('should return error if response JSON parsing fails', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new Error('Parse error')),
        text: () => Promise.resolve('<html>error</html>'),
      } as any);

      const result = await service.checkMono('test-id');
      expect(result).toEqual({ success: false, message: 'error parsing json' });
    });

    it('should return error if response has errCode', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ errCode: 1 }),
      } as any);

      const result = await service.checkMono('test-id');
      expect(result).toEqual({ success: false, message: 'check the jar id' });
    });

    it('should return success payload if successful', async () => {
      const payload = {
        name: 'My Jar',
        jarAmount: 1500,
        jarGoal: 5000,
        jarStatus: 'ACTIVE',
        ownerName: 'Alice',
      };
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(payload),
      } as any);

      const result = await service.checkMono('test-id');
      expect(result).toEqual({
        success: true,
        title: 'My Jar',
        balance: 1500,
        goal: 5000,
        status: 'ACTIVE',
        ownerName: 'Alice',
      });
    });

    it('should return amount directly if plain option is true', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ jarAmount: 1200 }),
      } as any);

      const result = await service.checkMono('test-id', true);
      expect(result).toBe(1200);
    });
  });

  describe('isJarActiveStatus', () => {
    it('should return true if active', () => {
      expect(service.isJarActiveStatus({ status: JarStatus.ACTIVE } as any)).toBe(true);
      expect(service.isJarActiveStatus({ status: 'INACTIVE' } as any)).toBe(false);
    });
  });

  describe('watch', () => {
    it('should return failure if checkMono fails', async () => {
      jest.spyOn(service, 'checkMono').mockResolvedValue({ success: false, message: 'error' });
      const result = await service.watch(AccountType.MONO, 'test-id');
      expect(result).toEqual({ success: false, message: 'error' });
    });

    it('should reactivate existing inactive account if forced', async () => {
      jest.spyOn(service, 'checkMono').mockResolvedValue({ success: true, balance: 100 } as any);
      prisma.account.findFirst.mockResolvedValue({ id: 1, trackId: 'test-id', isActive: false });
      prisma.accountIncoming.findMany.mockResolvedValue([{ id: 10, balance: 100 }]);
      jest.spyOn(service, 'activateAccount').mockResolvedValue(undefined);

      const result = await service.watch(AccountType.MONO, 'test-id', true);
      expect(service.activateAccount).toHaveBeenCalledWith(1);
      expect(result).toHaveProperty('account');
      expect(result).toHaveProperty('incoming');
    });

    it('should create new account if not exists', async () => {
      jest.spyOn(service, 'checkMono').mockResolvedValue({ success: true, balance: 100 } as any);
      prisma.account.findFirst.mockResolvedValue(null);
      prisma.account.create.mockResolvedValue({ id: 2, trackId: 'test-id', isActive: true });

      const result = await service.watch(AccountType.MONO, 'test-id');
      expect(prisma.account.create).toHaveBeenCalled();
      expect(result).toEqual({
        account: { id: 2, trackId: 'test-id', isActive: true },
        jar: { success: true, balance: 100 },
        incoming: [],
      });
    });
  });

  describe('getActiveAccounts', () => {
    it('should call findMany with active condition', async () => {
      prisma.account.findMany.mockResolvedValue([]);
      await service.getActiveAccounts();
      expect(prisma.account.findMany).toHaveBeenCalledWith({ where: { isActive: true } });
    });
  });

  describe('getActiveAccountIncomings', () => {
    it('should read from cache if enabled and present', async () => {
      redisReader.read.mockResolvedValue([{ id: 1 }]);
      const result = await service.getActiveAccountIncomings();
      expect(redisReader.read).toHaveBeenCalled();
      expect(result).toEqual([{ id: 1 }]);
      expect(prisma.account.findMany).not.toHaveBeenCalled();
    });

    it('should fetch from database if cache is empty', async () => {
      redisReader.read.mockResolvedValue(null);
      prisma.account.findMany.mockResolvedValue([{ id: 1 }]);

      const result = await service.getActiveAccountIncomings();
      expect(prisma.account.findMany).toHaveBeenCalled();
      expect(redisReader.write).toHaveBeenCalledWith(expect.any(String), [{ id: 1 }]);
      expect(result).toEqual([{ id: 1 }]);
    });
  });

  describe('refreshAccounts', () => {
    it('should do nothing if accounts is empty', async () => {
      jest.spyOn(service, 'getActiveAccountIncomings').mockResolvedValue([]);
      const deactivateSpy = jest.spyOn(service, 'deactivateAccount').mockResolvedValue(undefined);
      await service.refreshAccounts();
      expect(deactivateSpy).not.toHaveBeenCalled();
    });

    it('should deactivate old accounts', async () => {
      const oldAccount = { id: 1, trackId: '1', createdAt: new Date() };
      jest.spyOn(service, 'getActiveAccountIncomings').mockResolvedValue([oldAccount] as any);
      jest.spyOn(service, 'isAccountOld').mockReturnValue(true);
      const deactivateSpy = jest.spyOn(service, 'deactivateAccount').mockResolvedValue(undefined);

      await service.refreshAccounts();
      expect(deactivateSpy).toHaveBeenCalledWith(1);
      expect(analyticsService.trackEvent).toHaveBeenCalled();
    });
  });

  describe('syncAccounts', () => {
    it('should check active accounts and update incoming if balance changes', async () => {
      const account = { id: 1, type: AccountType.MONO, trackId: '1', accountIncomings: [] };
      jest.spyOn(service, 'getActiveAccountIncomings').mockResolvedValue([account] as any);
      jest
        .spyOn(service, 'checkMono')
        .mockResolvedValue({ success: true, status: JarStatus.ACTIVE, balance: 200 } as any);
      jest.spyOn(service, 'getRecentAccountIncoming').mockResolvedValue(null);
      prisma.accountIncoming.create.mockResolvedValue({ balance: 200 });

      await service.syncAccounts();
      expect(prisma.accountIncoming.create).toHaveBeenCalled();
      expect(redisReader.delete).toHaveBeenCalledWith(expect.stringContaining('recent-incoming-1'));
    });
  });

  describe('getRecentAccountIncoming', () => {
    it('should read from cache if present', async () => {
      redisReader.read.mockResolvedValue({ id: 99 });
      const result = await service.getRecentAccountIncoming(1);
      expect(redisReader.read).toHaveBeenCalled();
      expect(result).toEqual({ id: 99 });
    });

    it('should read from database if cache is empty', async () => {
      redisReader.read.mockResolvedValue(null);
      prisma.accountIncoming.findFirst.mockResolvedValue({ id: 99 });

      const result = await service.getRecentAccountIncoming(1);
      expect(prisma.accountIncoming.findFirst).toHaveBeenCalled();
      expect(redisReader.write).toHaveBeenCalled();
      expect(result).toEqual({ id: 99 });
    });
  });

  describe('isAccountOld', () => {
    it('should determine age based on incomings and creation dates', () => {
      // 1. No incomings, created over 2 weeks ago
      const twoWeeksAgo = new Date();
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 15);
      expect(service.isAccountOld({ createdAt: twoWeeksAgo, accountIncomings: [] } as any)).toBe(
        true
      );

      // 2. Incoming created over 2 weeks ago
      expect(
        service.isAccountOld({
          createdAt: new Date(),
          accountIncomings: [{ createdAt: twoWeeksAgo }],
        } as any)
      ).toBe(true);

      // 3. New account, recent incoming
      const recentDate = new Date();
      expect(
        service.isAccountOld({
          createdAt: recentDate,
          accountIncomings: [{ createdAt: recentDate }],
        } as any)
      ).toBe(false);
    });
  });

  describe('activateAccount', () => {
    it('should update db active state and invalidate cache', async () => {
      prisma.account.update.mockResolvedValue({});
      jest.spyOn(service, 'invalidateCachedActiveAccounts').mockResolvedValue(undefined);

      await service.activateAccount(1);
      expect(prisma.account.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { isActive: true },
      });
      expect(service.invalidateCachedActiveAccounts).toHaveBeenCalled();
    });
  });

  describe('deactivateAccountByTrackId', () => {
    it('should deactivate active account by trackId', async () => {
      prisma.account.findFirst.mockResolvedValue({ id: 1, trackId: 't1', isActive: true });
      jest.spyOn(service, 'checkMono').mockResolvedValue({ title: 'My Jar' } as any);
      const deactivateSpy = jest.spyOn(service, 'deactivateAccount').mockResolvedValue(undefined);

      await service.deactivateAccountByTrackId('t1');
      expect(deactivateSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('cacheData and readCache', () => {
    it('should write data to file if file does not exist', async () => {
      (fs.access as jest.Mock).mockRejectedValue(new Error('File not found'));
      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);

      await service.cacheData('file.txt', 'content');
      expect(fs.mkdir).toHaveBeenCalledWith('tmp', { recursive: true });
      expect(fs.writeFile).toHaveBeenCalledWith('tmp/file.txt', 'content', { encoding: 'utf-8' });
    });

    it('should read file content if file exists', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readFile as jest.Mock).mockResolvedValue('stored content');

      const result = await service.readCache('file.txt');
      expect(result).toBe('stored content');
    });

    it('should return null if file does not exist on readCache', async () => {
      (fs.access as jest.Mock).mockRejectedValue(new Error('File not found'));

      const result = await service.readCache('file.txt');
      expect(result).toBeNull();
    });
  });
});
