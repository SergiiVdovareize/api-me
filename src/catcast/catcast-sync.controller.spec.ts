import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CatcastSyncController } from './catcast-sync.controller';
import { CatcastSyncService } from './catcast-sync.service';
import { CatcastSyncGuard } from './catcast-sync.guard';

describe('CatcastSyncController', () => {
  let controller: CatcastSyncController;
  let mockSyncService: jest.Mocked<Partial<CatcastSyncService>>;
  let mockConfigService: jest.Mocked<Partial<ConfigService>>;

  const mockReq: any = {
    headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
    catcastSync: {
      profileId: 'prof-1',
      deviceId: 'dev-1',
      platform: 'web',
    },
  };

  beforeEach(async () => {
    mockSyncService = {
      initProfile: jest
        .fn()
        .mockResolvedValue({ profileId: 'prof-1', syncToken: 'tok', serverTs: 1 }),
      pairInit: jest
        .fn()
        .mockResolvedValue({ code: 'ABC234', pairSecret: 'sec', expiresAt: '2026' }),
      pairConfirm: jest.fn().mockResolvedValue({ status: 'awaiting_acceptance' }),
      pairStatus: jest.fn().mockResolvedValue({ status: 'pending' }),
      pairAccept: jest.fn().mockResolvedValue({ status: 'confirmed', syncToken: 'tok2' }),
      listDevices: jest.fn().mockResolvedValue({ profileId: 'prof-1', devices: [] }),
      removeDevice: jest
        .fn()
        .mockResolvedValue({ success: true, deviceId: 'dev-2', mode: 'unlink' }),
      push: jest.fn().mockResolvedValue({ serverTs: 123 }),
      pull: jest.fn().mockResolvedValue({ serverTs: 123, history: [], favorites: [] }),
      cleanupExpiredData: jest
        .fn()
        .mockResolvedValue({ deletedTombstones: 0, deletedOrphanProfiles: 0 }),
    };

    mockConfigService = {
      get: jest.fn().mockReturnValue('secret-cron'),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CatcastSyncController],
      providers: [
        { provide: CatcastSyncService, useValue: mockSyncService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    })
      .overrideGuard(CatcastSyncGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<CatcastSyncController>(CatcastSyncController);
  });

  it('delegates profile init, pairing, devices, push, pull and cleanup', async () => {
    await controller.initProfile({ deviceId: 'dev-1' }, mockReq);
    expect(mockSyncService.initProfile).toHaveBeenCalledWith(
      { deviceId: 'dev-1' },
      '1.2.3.4',
      expect.any(Object)
    );

    await controller.pairInit(mockReq, { deviceId: 'dev-1' });
    expect(mockSyncService.pairInit).toHaveBeenCalledWith(
      mockReq.catcastSync,
      { deviceId: 'dev-1' },
      expect.any(Object)
    );

    await controller.pairConfirm({ code: 'ABC234', deviceId: 'dev-2' }, mockReq);
    expect(mockSyncService.pairConfirm).toHaveBeenCalledWith(
      { code: 'ABC234', deviceId: 'dev-2' },
      '1.2.3.4',
      expect.any(Object)
    );

    await controller.pairStatus('ABC234', 'sec', mockReq, 'joiner');
    expect(mockSyncService.pairStatus).toHaveBeenCalledWith('ABC234', 'sec', '1.2.3.4', 'joiner');

    await controller.pairAccept(mockReq, { code: 'ABC234', pairSecret: 'sec', accept: true });
    expect(mockSyncService.pairAccept).toHaveBeenCalledWith(
      mockReq.catcastSync,
      { code: 'ABC234', pairSecret: 'sec', accept: true },
      expect.any(Object)
    );

    await controller.listDevices(mockReq);
    expect(mockSyncService.listDevices).toHaveBeenCalledWith(mockReq.catcastSync);

    await controller.removeDevice(mockReq, 'dev-2', { mode: 'revoke' });
    expect(mockSyncService.removeDevice).toHaveBeenCalledWith(
      mockReq.catcastSync,
      'dev-2',
      'revoke'
    );

    await controller.removeDevice(mockReq, 'dev-2', {});
    expect(mockSyncService.removeDevice).toHaveBeenCalledWith(
      mockReq.catcastSync,
      'dev-2',
      'unlink'
    );

    await controller.push(mockReq, { history: [] });
    expect(mockSyncService.push).toHaveBeenCalledWith(
      mockReq.catcastSync,
      { history: [] },
      expect.any(Object)
    );

    await controller.pull(mockReq, '100');
    expect(mockSyncService.pull).toHaveBeenCalledWith(
      mockReq.catcastSync,
      '100',
      expect.any(Object)
    );

    await controller.cleanup('secret-cron');
    expect(mockSyncService.cleanupExpiredData).toHaveBeenCalled();
  });

  it('extracts client IP from cf-connecting-ip, socket.remoteAddress, req.ip, or fallback', async () => {
    await controller.initProfile({ deviceId: 'd1' }, {
      headers: { 'cf-connecting-ip': '9.9.9.9' },
    } as any);
    expect(mockSyncService.initProfile).toHaveBeenLastCalledWith(
      { deviceId: 'd1' },
      '9.9.9.9',
      expect.any(Object)
    );

    await controller.initProfile({ deviceId: 'd1' }, {
      headers: {},
      socket: { remoteAddress: '8.8.8.8' },
    } as any);
    expect(mockSyncService.initProfile).toHaveBeenLastCalledWith(
      { deviceId: 'd1' },
      '8.8.8.8',
      expect.any(Object)
    );

    await controller.initProfile({ deviceId: 'd1' }, { headers: {}, ip: '7.7.7.7' } as any);
    expect(mockSyncService.initProfile).toHaveBeenLastCalledWith(
      { deviceId: 'd1' },
      '7.7.7.7',
      expect.any(Object)
    );

    await controller.initProfile({ deviceId: 'd1' }, { headers: {} } as any);
    expect(mockSyncService.initProfile).toHaveBeenLastCalledWith(
      { deviceId: 'd1' },
      '127.0.0.1',
      expect.any(Object)
    );
  });
});
