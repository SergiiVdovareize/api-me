import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { OriginGuard } from './origin.guard';
import { env } from 'process';

describe('OriginGuard', () => {
  let guard: OriginGuard;
  let mockContext: Partial<ExecutionContext>;
  let mockRequest: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OriginGuard],
    }).compile();

    guard = module.get<OriginGuard>(OriginGuard);

    mockRequest = {
      headers: {},
    };

    mockContext = {
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(mockRequest),
      }),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should allow access if origin header matches allowed origin', () => {
    mockRequest.headers.origin = 'https://snip.vdovareize.me';

    expect(guard.canActivate(mockContext as ExecutionContext)).toBe(true);
  });

  it('should allow access if origin header ends with slash and matches allowed origin', () => {
    mockRequest.headers.origin = 'https://snip.vdovareize.me/';

    expect(guard.canActivate(mockContext as ExecutionContext)).toBe(true);
  });

  it('should allow access if referer header matches allowed origin', () => {
    mockRequest.headers.referer = 'https://snip.vdovareize.me';

    expect(guard.canActivate(mockContext as ExecutionContext)).toBe(true);
  });

  it('should throw ForbiddenException if neither origin nor referer match allowed origin', () => {
    mockRequest.headers.origin = 'https://unauthorized-origin.com';
    mockRequest.headers.referer = 'https://unauthorized-referer.com';

    expect(() => {
      guard.canActivate(mockContext as ExecutionContext);
    }).toThrow(ForbiddenException);
  });

  describe('Local Development Bypass', () => {
    let originalHost: string | undefined;
    let originalNodeEnv: string | undefined;

    beforeEach(() => {
      originalHost = env.HOST;
      originalNodeEnv = process.env.NODE_ENV;
    });

    afterEach(() => {
      env.HOST = originalHost;
      process.env.NODE_ENV = originalNodeEnv;
    });

    it('should allow access if HOST is local, NODE_ENV is not test, and headers are localhost', () => {
      env.HOST = 'local';
      // Mock NODE_ENV to not be 'test'
      Object.defineProperty(process.env, 'NODE_ENV', {
        value: 'development',
        configurable: true,
      });

      mockRequest.headers.origin = 'http://localhost:3000';

      expect(guard.canActivate(mockContext as ExecutionContext)).toBe(true);
    });

    it('should allow access if HOST is local, NODE_ENV is not test, and headers are missing', () => {
      env.HOST = 'local';
      Object.defineProperty(process.env, 'NODE_ENV', {
        value: 'development',
        configurable: true,
      });

      expect(guard.canActivate(mockContext as ExecutionContext)).toBe(true);
    });

    it('should throw ForbiddenException if HOST is local but headers are unauthorized external site', () => {
      env.HOST = 'local';
      Object.defineProperty(process.env, 'NODE_ENV', {
        value: 'development',
        configurable: true,
      });

      mockRequest.headers.origin = 'https://unauthorized-external.com';

      expect(() => {
        guard.canActivate(mockContext as ExecutionContext);
      }).toThrow(ForbiddenException);
    });
  });
});
