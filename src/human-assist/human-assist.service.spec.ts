import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { HumanAssistService } from './human-assist.service';
import { PrismaService } from '../models/prisma/prisma.service';

describe('HumanAssistService', () => {
  let service: HumanAssistService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      humanAssistSync: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HumanAssistService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<HumanAssistService>(HumanAssistService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getSyncData', () => {
    it('should throw BadRequestException if userId is empty', async () => {
      await expect(service.getSyncData('')).rejects.toThrow(BadRequestException);
    });

    it('should return empty data and null updatedAt if record is not found', async () => {
      mockPrisma.humanAssistSync.findUnique.mockResolvedValue(null);

      const result = await service.getSyncData('964486');

      expect(mockPrisma.humanAssistSync.findUnique).toHaveBeenCalledWith({
        where: { userId: '964486' },
      });
      expect(result).toEqual({
        userId: '964486',
        data: {},
        updatedAt: null,
      });
    });

    it('should return stored data and numeric timestamp if record exists', async () => {
      const updatedAt = new Date('2026-10-23T08:00:00.000Z');
      mockPrisma.humanAssistSync.findUnique.mockResolvedValue({
        userId: '964486',
        data: {
          studentStatuses: {
            '1094594': { '332145': 'abroad' },
          },
          settings: { showStudentStatuses: true },
        },
        createdAt: new Date('2026-10-22T08:00:00.000Z'),
        updatedAt,
      });

      const result = await service.getSyncData('964486');

      expect(result).toEqual({
        userId: '964486',
        data: {
          studentStatuses: {
            '1094594': { '332145': 'abroad' },
          },
          settings: { showStudentStatuses: true },
        },
        updatedAt: updatedAt.getTime(),
      });
    });
  });

  describe('saveSyncData', () => {
    it('should throw BadRequestException if userId is empty', async () => {
      await expect(service.saveSyncData('', { data: {} })).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if payload data is missing or not an object', async () => {
      await expect(service.saveSyncData('964486', null as any)).rejects.toThrow(BadRequestException);
      await expect(service.saveSyncData('964486', { data: null } as any)).rejects.toThrow(
        BadRequestException
      );
      await expect(service.saveSyncData('964486', { data: 'invalid' } as any)).rejects.toThrow(
        BadRequestException
      );
    });

    it('should perform upsert and return success true with numeric updatedAt', async () => {
      const now = new Date('2026-10-23T09:00:00.000Z');
      const payload = {
        data: {
          studentStatuses: {
            '1094594': { '332145': 'abroad' },
          },
        },
      };

      mockPrisma.humanAssistSync.upsert.mockResolvedValue({
        userId: '964486',
        data: payload.data,
        createdAt: now,
        updatedAt: now,
      });

      const result = await service.saveSyncData('964486', payload);

      expect(mockPrisma.humanAssistSync.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: '964486' },
          create: expect.objectContaining({
            userId: '964486',
            data: payload.data,
          }),
          update: expect.objectContaining({
            data: payload.data,
          }),
        })
      );
      expect(result).toEqual({
        success: true,
        updatedAt: now.getTime(),
      });
    });
  });
});
