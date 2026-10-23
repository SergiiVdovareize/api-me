import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HumanAssistGuard } from './human-assist.guard';

describe('HumanAssistGuard', () => {
  let guard: HumanAssistGuard;
  let mockConfigService: any;
  let mockRequest: any;
  let mockContext: Partial<ExecutionContext>;

  beforeEach(async () => {
    mockConfigService = {
      get: jest.fn().mockImplementation((key: string, defaultValue?: any) => {
        if (key === 'HUMAN_ASSIST_SYNC_SECRET' || key === 'SYNC_SECRET') return 'test_sync_secret';
        if (key === 'HOST') return 'production';
        if (key === 'NODE_ENV') return 'production';
        return defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HumanAssistGuard,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    guard = module.get<HumanAssistGuard>(HumanAssistGuard);

    mockRequest = {
      method: 'GET',
      headers: {
        origin: 'https://human.ua',
        'x-sync-secret': 'test_sync_secret',
      },
    };

    mockContext = {
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(mockRequest),
      }),
    };
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should allow OPTIONS preflight request without checking secret or origin', () => {
    mockRequest.method = 'OPTIONS';
    mockRequest.headers = {};

    expect(guard.canActivate(mockContext as ExecutionContext)).toBe(true);
  });

  it('should allow valid origin https://human.ua with correct secret', () => {
    mockRequest.headers = {
      origin: 'https://human.ua',
      'x-sync-secret': 'test_sync_secret',
    };

    expect(guard.canActivate(mockContext as ExecutionContext)).toBe(true);
  });

  it('should allow valid subdomain origin https://myschool.human.ua with correct secret', () => {
    mockRequest.headers = {
      origin: 'https://myschool.human.ua',
      'x-sync-secret': 'test_sync_secret',
    };

    expect(guard.canActivate(mockContext as ExecutionContext)).toBe(true);
  });

  it('should throw ForbiddenException if origin is not allowed', () => {
    mockRequest.headers = {
      origin: 'https://evil.com',
      'x-sync-secret': 'test_sync_secret',
    };

    expect(() => guard.canActivate(mockContext as ExecutionContext)).toThrow(ForbiddenException);
  });

  it('should throw ForbiddenException if origin header is missing in production', () => {
    mockRequest.headers = {
      'x-sync-secret': 'test_sync_secret',
    };

    expect(() => guard.canActivate(mockContext as ExecutionContext)).toThrow(ForbiddenException);
  });

  it('should throw UnauthorizedException if x-sync-secret is missing', () => {
    mockRequest.headers = {
      origin: 'https://human.ua',
    };

    expect(() => guard.canActivate(mockContext as ExecutionContext)).toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException if x-sync-secret does not match', () => {
    mockRequest.headers = {
      origin: 'https://human.ua',
      'x-sync-secret': 'wrong_secret',
    };

    expect(() => guard.canActivate(mockContext as ExecutionContext)).toThrow(UnauthorizedException);
  });

  it('should allow localhost origin in local dev mode', () => {
    mockConfigService.get.mockImplementation((key: string, defaultValue?: any) => {
      if (key === 'HOST') return 'local';
      if (key === 'NODE_ENV') return 'development';
      if (key === 'HUMAN_ASSIST_SYNC_SECRET') return 'test_sync_secret';
      return defaultValue;
    });

    mockRequest.headers = {
      origin: 'http://localhost:3000',
      'x-sync-secret': 'test_sync_secret',
    };

    expect(guard.canActivate(mockContext as ExecutionContext)).toBe(true);
  });
});
