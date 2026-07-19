import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AlphadateService } from './alphadate.service';
import { PrismaService } from '../models/prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';

describe('AlphadateService', () => {
  let service: AlphadateService;
  let mockPrismaService: any;
  let mockEmailService: any;
  let mockConfigService: any;

  beforeEach(async () => {
    mockPrismaService = {
      $transaction: jest.fn().mockImplementation(async cb => {
        return await cb(mockPrismaService);
      }),
      alphadateBoard: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      alphadatePartner: {
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
    };

    mockEmailService = {
      sendEmail: jest.fn().mockResolvedValue({ id: 'msg-123' }),
    };

    mockConfigService = {
      get: jest.fn().mockReturnValue('http://localhost:3000'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlphadateService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: EmailService,
          useValue: mockEmailService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<AlphadateService>(AlphadateService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a board, generate random key, randomize partner, and send email', async () => {
      const dto = {
        email: 'test@example.com',
        partners: ['Partner A', 'Partner B'],
      };

      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue(null);
      mockPrismaService.alphadateBoard.create.mockResolvedValue({ key: 'abcde', email: dto.email });
      mockPrismaService.alphadatePartner.create
        .mockResolvedValueOnce({ id: 1, name: 'Partner A', turnOrder: 1 })
        .mockResolvedValueOnce({ id: 2, name: 'Partner B', turnOrder: 2 });
      mockPrismaService.alphadateBoard.update.mockResolvedValue({
        key: 'abcde',
        currentPartnerId: 1,
      });

      const result = await service.create(dto);

      expect(result).toBeDefined();
      expect(mockPrismaService.alphadateBoard.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          key: expect.any(String),
          email: dto.email,
        }),
      });
      expect(mockPrismaService.alphadatePartner.create).toHaveBeenCalledTimes(2);
      expect(mockPrismaService.alphadateBoard.update).toHaveBeenCalled();
      // Wait for background email execution context by letting next ticks resolve
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
        dto.email,
        expect.stringContaining('AlphaDate'),
        expect.stringContaining('Partner A')
      );
    });

    it('should throw ConflictException if unique key cannot be generated after 10 retries', async () => {
      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue({ key: 'colliding-key' });

      await expect(
        service.create({ email: 'test@example.com', partners: ['Partner A'] })
      ).rejects.toThrow(ConflictException);
      expect(mockPrismaService.alphadateBoard.findUnique).toHaveBeenCalledTimes(10);
    });
  });

  describe('getBoardState', () => {
    it('should throw NotFoundException if board key does not exist', async () => {
      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue(null);

      await expect(service.getBoardState('invalid-key')).rejects.toThrow(NotFoundException);
    });

    it('should return board state successfully', async () => {
      const dbBoard = {
        key: 'valid-key',
        letters: [{ letter: 'A', status: 'available' }],
        currentPartnerId: 10,
        pin: 'pin-hash',
        partners: [
          { id: 10, name: 'Alice', turnOrder: 1 },
          { id: 20, name: 'Bob', turnOrder: 2 },
        ],
      };

      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue(dbBoard);

      const result = await service.getBoardState('valid-key');
      expect(result).toEqual({
        success: true,
        letters: dbBoard.letters,
        metadata: {
          partners: [
            { id: 10, name: 'Alice' },
            { id: 20, name: 'Bob' },
          ],
          currentPartnerId: 10,
          pinHash: 'pin-hash',
        },
      });
    });
  });

  describe('updateBoardState', () => {
    it('should throw NotFoundException if board not found', async () => {
      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue(null);

      await expect(service.updateBoardState('key', { letters: [] })).rejects.toThrow(
        NotFoundException
      );
    });

    it('should transition partner turn when a letter changes status to used', async () => {
      const dbBoard = {
        key: 'key',
        letters: [
          { letter: 'A', status: 'available' },
          { letter: 'B', status: 'available' },
        ],
        currentPartnerId: 1,
      };

      const partnersList = [
        { id: 1, name: 'Alice', turnOrder: 1 },
        { id: 2, name: 'Bob', turnOrder: 2 },
      ];

      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue(dbBoard);
      mockPrismaService.alphadatePartner.findMany.mockResolvedValue(partnersList);

      const dto = {
        letters: [
          { letter: 'A', status: 'used' as const },
          { letter: 'B', status: 'available' as const },
        ],
      };

      const result = await service.updateBoardState('key', dto);
      expect(result.success).toBe(true);
      expect(result.currentPartnerId).toBe(2); // Turn transitioned from Alice (1) to Bob (2)
      expect(mockPrismaService.alphadateBoard.update).toHaveBeenCalledWith({
        where: { key: 'key' },
        data: expect.objectContaining({
          letters: dto.letters,
          currentPartnerId: 2,
        }),
      });
    });

    it('should re-randomize partner turn on full reset', async () => {
      const dbBoard = {
        key: 'key',
        letters: [{ letter: 'A', status: 'used' }],
        currentPartnerId: 1,
      };

      const partnersList = [
        { id: 1, name: 'Alice', turnOrder: 1 },
        { id: 2, name: 'Bob', turnOrder: 2 },
      ];

      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue(dbBoard);
      mockPrismaService.alphadatePartner.findMany.mockResolvedValue(partnersList);

      const dto = {
        letters: [{ letter: 'A', status: 'available' as const }],
      };

      const result = await service.updateBoardState('key', dto);
      expect(result.success).toBe(true);
      expect([1, 2]).toContain(result.currentPartnerId); // Randomly picked one of the partners
    });

    it('should update partners metadata and correctly edit names, delete extra, or add new partners', async () => {
      const dbBoard = {
        key: 'key',
        letters: [],
        currentPartnerId: 2,
      };

      const existingPartners = [
        { id: 1, name: 'Alice', turnOrder: 1 },
        { id: 2, name: 'Bob', turnOrder: 2 },
      ];

      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue(dbBoard);
      mockPrismaService.alphadatePartner.findMany
        // First mock call gets existing partners to check changes
        .mockResolvedValueOnce(existingPartners)
        // Second mock call returns updated list to perform turn calculations
        .mockResolvedValueOnce([{ id: 1, name: 'Alice Updated', turnOrder: 1 }]);

      const dto = {
        letters: [],
        metadata: {
          partners: ['Alice Updated'], // Deleted Bob, updated Alice
        },
      };

      const result = await service.updateBoardState('key', dto);
      expect(result.success).toBe(true);
      expect(mockPrismaService.alphadatePartner.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { name: 'Alice Updated' },
      });
      expect(mockPrismaService.alphadateBoard.update).toHaveBeenCalledWith({
        where: { key: 'key' },
        data: expect.objectContaining({ currentPartnerId: null }),
      });
      expect(mockPrismaService.alphadatePartner.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: [2] } },
      });
    });

    it('should update pin hash when metadata.pinHash is updated', async () => {
      const dbBoard = {
        key: 'key',
        letters: [],
        currentPartnerId: 1,
      };

      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue(dbBoard);
      mockPrismaService.alphadatePartner.findMany.mockResolvedValue([]);

      const dto = {
        letters: [],
        metadata: {
          pinHash: 'new-pin-hash',
        },
      };

      const result = await service.updateBoardState('key', dto);
      expect(result.success).toBe(true);
      expect(mockPrismaService.alphadateBoard.update).toHaveBeenCalledWith({
        where: { key: 'key' },
        data: expect.objectContaining({ pin: 'new-pin-hash' }),
      });
    });
  });

  describe('deleteBoard', () => {
    it('should throw NotFoundException if key not found', async () => {
      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue(null);

      await expect(service.deleteBoard('non-existent-key')).rejects.toThrow(NotFoundException);
    });

    it('should delete board successfully', async () => {
      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue({ key: 'to-delete' });
      mockPrismaService.alphadateBoard.delete.mockResolvedValue({});

      const result = await service.deleteBoard('to-delete');
      expect(result).toEqual({ success: true });
      expect(mockPrismaService.alphadateBoard.delete).toHaveBeenCalledWith({
        where: { key: 'to-delete' },
      });
    });
  });
});
