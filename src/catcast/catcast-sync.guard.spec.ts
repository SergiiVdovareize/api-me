import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { CatcastSyncGuard, hashSyncToken } from './catcast-sync.guard';

describe('CatcastSyncGuard', () => {
  let guard: CatcastSyncGuard;
  let mockPrisma: any;

  const createContext = (authHeader?: string): { ctx: ExecutionContext; req: any } => {
    const req: any = {
      headers: authHeader ? { authorization: authHeader } : {},
    };
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => req,
      }),
    } as unknown as ExecutionContext;
    return { ctx, req };
  };

  beforeEach(() => {
    mockPrisma = {
      catcastDevice: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    guard = new CatcastSyncGuard(mockPrisma);
  });

  it('should throw UnauthorizedException when Authorization header is missing', async () => {
    const { ctx } = createContext();
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException when token is invalid or not paired', async () => {
    mockPrisma.catcastDevice.findUnique.mockResolvedValue(null);
    const { ctx } = createContext('Bearer unknown-token');
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException when device is not allowed', async () => {
    mockPrisma.catcastDevice.findUnique.mockResolvedValue({
      id: 1,
      deviceId: 'dev-1',
      profileId: 'prof-1',
      isAllowed: false,
    });
    const { ctx } = createContext('Bearer valid-token');
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('should attach catcastSync context and update stale syncLastSeenAt', async () => {
    const token = 'my-secret-token';
    mockPrisma.catcastDevice.findUnique.mockResolvedValue({
      id: 10,
      deviceId: 'dev-1',
      profileId: 'prof-1',
      platform: 'desktop_web',
      model: 'MacBook',
      os: 'macOS',
      browser: 'Chrome',
      deviceName: 'My Mac',
      city: 'Kyiv',
      country: 'UA',
      isAllowed: true,
      syncLastSeenAt: null,
    });

    const { ctx, req } = createContext(`Bearer ${token}`);
    const allowed = await guard.canActivate(ctx);

    expect(allowed).toBe(true);
    expect(mockPrisma.catcastDevice.findUnique).toHaveBeenCalledWith({
      where: { syncTokenHash: hashSyncToken(token) },
    });
    expect(req.catcastSync).toEqual({
      profileId: 'prof-1',
      deviceId: 'dev-1',
      platform: 'desktop_web',
      model: 'MacBook',
      os: 'macOS',
      browser: 'Chrome',
      deviceName: 'My Mac',
      city: 'Kyiv',
      country: 'UA',
    });
    expect(mockPrisma.catcastDevice.update).toHaveBeenCalled();
  });
});
