import { Test, TestingModule } from '@nestjs/testing';
import { TrackController } from './track.controller';
import { TrackService } from './track.service';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { AccountType } from 'src/models/enums/account-type.enum';

describe('TrackController', () => {
  let controller: TrackController;
  let trackService: any;
  let analyticsService: any;

  beforeEach(async () => {
    trackService = {
      syncAccounts: jest.fn().mockResolvedValue(undefined),
      refreshAccounts: jest.fn().mockResolvedValue(undefined),
      deactivateAccountByTrackId: jest.fn().mockResolvedValue(undefined),
      checkMono: jest.fn().mockResolvedValue({ balance: 1000 }),
      watch: jest.fn().mockResolvedValue({ id: '123', watching: true }),
    };
    analyticsService = {
      trackEvent: jest.fn(),
      trackApiEvent: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TrackController],
      providers: [
        {
          provide: TrackService,
          useValue: trackService,
        },
        {
          provide: AnalyticsService,
          useValue: analyticsService,
        },
      ],
    }).compile();

    controller = module.get<TrackController>(TrackController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should call trackService.syncAccounts on GET /track', async () => {
    const res = await controller.track();
    expect(res).toEqual({ success: true });
    expect(trackService.syncAccounts).toHaveBeenCalled();
  });

  it('should return ping and pong with formatted timestamp', async () => {
    const ping = await controller.ping();
    expect(ping.state).toBe('ping');
    expect(ping.timestamp).toMatch(/^\d{2}:\d{2}:\d{2}$/);

    const pong = await controller.pong();
    expect(pong.state).toBe('pong');
    expect(pong.timestamp).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('should call refreshAccounts on GET /refresh', async () => {
    const res = await controller.refresh();
    expect(res).toEqual({ success: true });
    expect(trackService.refreshAccounts).toHaveBeenCalled();
  });

  describe('deactivate', () => {
    it('should deactivate account via POST method', async () => {
      const result = await controller.deactivate('test-track-123');
      expect(result).toEqual({ success: true });
      expect(trackService.deactivateAccountByTrackId).toHaveBeenCalledWith('test-track-123');
    });
  });

  describe('check', () => {
    it('should return error for invalid account type', async () => {
      const res = await controller.check('INVALID' as any, '123', 'false');
      expect(res).toEqual({ success: false, message: 'Invalid type: INVALID' });
    });

    it('should check Mono account with plain=true and plain=false', async () => {
      const res1 = await controller.check(AccountType.MONO, '123', 'true');
      expect(trackService.checkMono).toHaveBeenCalledWith('123', true);
      expect(res1).toEqual({ balance: 1000 });

      const res2 = await controller.check(AccountType.MONO, '123', '0');
      expect(trackService.checkMono).toHaveBeenCalledWith('123', false);
      expect(res2).toEqual({ balance: 1000 });
    });

    it('should return unsupported message for PRIVAT type', async () => {
      const res = await controller.check(AccountType.PRIVAT, '456', 'false');
      expect(res).toEqual({
        success: false,
        message: 'Type is not yet supported: privat',
      });
    });
  });

  describe('findOne (mono)', () => {
    it('should check mono account with plain query', async () => {
      const res = await controller.findOne('123', '1');
      expect(trackService.checkMono).toHaveBeenCalledWith('123', true);
      expect(res).toEqual({ balance: 1000 });
    });
  });

  describe('watch', () => {
    it('should call watch service and track event', async () => {
      const res = await controller.watch(AccountType.MONO, '123', 'true');
      expect(trackService.watch).toHaveBeenCalledWith(AccountType.MONO, '123', true);
      expect(res).toEqual({
        success: true,
        watch: { id: '123', watching: true },
      });

      await controller.watch(AccountType.MONO, '123', 'false');
      expect(trackService.watch).toHaveBeenCalledWith(AccountType.MONO, '123', false);
    });
  });
});
