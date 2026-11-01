import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import {
  PrismaService,
  isTransientConnectionError,
  TRANSIENT_ERROR_CODES,
  MAX_CONNECTION_RETRIES,
} from './prisma.service';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();

    service = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should call $disconnect on onModuleDestroy', async () => {
    const disconnectSpy = jest
      .spyOn(service as any, '$disconnect')
      .mockResolvedValue(undefined as never);

    await service.onModuleDestroy();

    expect(disconnectSpy).toHaveBeenCalled();
  });

  describe('isTransientConnectionError', () => {
    it.each(TRANSIENT_ERROR_CODES)(
      'should return true for known transient error code %s',
      (code) => {
        expect(isTransientConnectionError({ code })).toBe(true);
      }
    );

    it('should return false for non-transient prisma error code (e.g. P2002)', () => {
      expect(isTransientConnectionError({ code: 'P2002' })).toBe(false);
    });

    it('should return true for PrismaClientInitializationError instance', () => {
      const initError = new Prisma.PrismaClientInitializationError(
        'Can not reach database',
        '6.0.0'
      );
      expect(isTransientConnectionError(initError)).toBe(true);
    });

    it.each([
      'Server has closed the connection.',
      'Connection closed unexpectedly',
      'connection terminated by server',
      'read ECONNRESET',
      'connect ETIMEDOUT 127.0.0.1',
      'terminating connection due to administrator command',
    ])('should return true for message containing: %s', (message) => {
      expect(isTransientConnectionError(new Error(message))).toBe(true);
    });

    it('should return false for general business/validation errors', () => {
      expect(isTransientConnectionError(new Error('Record to update not found'))).toBe(false);
      expect(isTransientConnectionError(new Error('Invalid input data'))).toBe(false);
    });

    it('should return false for null, undefined, and non-object inputs', () => {
      expect(isTransientConnectionError(null)).toBe(false);
      expect(isTransientConnectionError(undefined)).toBe(false);
      expect(isTransientConnectionError('some error string')).toBe(false);
      expect(isTransientConnectionError(123)).toBe(false);
    });
  });
});
