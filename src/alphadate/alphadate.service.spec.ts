import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { AlphadateService } from './alphadate.service';
import { PrismaService } from '../models/prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';
import { GenderizeService } from './genderize.service';
import { LlmService } from '../llm/llm.service';
import { RedisReader } from '../common/helpers/redisReader';
import { BlobService } from '../blob/blob.service';

describe('AlphadateService', () => {
  let service: AlphadateService;
  let mockPrismaService: any;
  let mockEmailService: any;
  let mockConfigService: any;
  let mockGenderizeService: any;
  let mockLlmService: any;
  let mockRedisReader: any;
  let mockBlobService: any;

  beforeEach(async () => {
    mockPrismaService = {
      $transaction: jest.fn().mockImplementation(async cb => {
        return await cb(mockPrismaService);
      }),
      alphadateBoard: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
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
      alphadateHistory: {
        upsert: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
      },
    };

    mockEmailService = {
      sendEmail: jest.fn().mockResolvedValue({ id: 'msg-123' }),
    };

    mockConfigService = {
      get: jest.fn().mockReturnValue('http://localhost:3000'),
    };

    mockGenderizeService = {
      detectGenders: jest.fn().mockResolvedValue(['female', 'male']),
      assignPlayerIds: jest.fn().mockReturnValue([2, 1]),
    };

    mockLlmService = {
      callAndParseJSON: jest.fn(),
    };

    mockRedisReader = {
      read: jest.fn().mockResolvedValue(null),
      write: jest.fn().mockResolvedValue('OK'),
      delete: jest.fn().mockResolvedValue(1),
    };

    mockBlobService = {
      upload: jest.fn().mockResolvedValue('https://blob.vercel-storage.com/alphadate/key/A.webp'),
      remove: jest.fn().mockResolvedValue({}),
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
        {
          provide: GenderizeService,
          useValue: mockGenderizeService,
        },
        {
          provide: LlmService,
          useValue: mockLlmService,
        },
        {
          provide: RedisReader,
          useValue: mockRedisReader,
        },
        {
          provide: BlobService,
          useValue: mockBlobService,
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
        expect.stringContaining('Partner&nbsp;A')
      );
    });

    it('should throw ConflictException if unique key cannot be generated after 10 retries', async () => {
      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue({ key: 'colliding-key' });

      await expect(
        service.create({ email: 'test@example.com', partners: ['Partner A'] })
      ).rejects.toThrow(ConflictException);
      expect(mockPrismaService.alphadateBoard.findUnique).toHaveBeenCalledTimes(10);
    });

    it('should hash and store pin when pin is provided in dto', async () => {
      const dto = {
        email: 'test@example.com',
        partners: ['Partner A'],
        pin: '1234',
      };

      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue(null);
      mockPrismaService.alphadateBoard.create.mockResolvedValue({ key: 'abcde', email: dto.email });
      mockPrismaService.alphadatePartner.create.mockResolvedValue({
        id: 1,
        name: 'Partner A',
        turnOrder: 1,
      });
      mockPrismaService.alphadateBoard.update.mockResolvedValue({
        key: 'abcde',
        currentPartnerId: 1,
      });

      await service.create(dto);

      expect(mockPrismaService.alphadateBoard.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          key: expect.any(String),
          email: dto.email,
          pin: expect.stringContaining(':'),
        }),
      });
    });
  });

  describe('getBoardState', () => {
    it('should throw NotFoundException if board key does not exist', async () => {
      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue(null);

      await expect(service.getBoardState('invalid-key')).rejects.toThrow(NotFoundException);
    });

    it('should throw UnauthorizedException if board has PIN and none is provided', async () => {
      const dbBoard = {
        key: 'protected-key',
        pin: 'pin-hash',
        partners: [],
        history: [],
      };
      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue(dbBoard);

      await expect(service.getBoardState('protected-key')).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if board has PIN and invalid PIN is provided', async () => {
      const dbBoard = {
        key: 'protected-key',
        pin: 'pin-hash',
        partners: [],
        history: [],
      };
      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue(dbBoard);

      await expect(service.getBoardState('protected-key', 'wrong-pin')).rejects.toThrow(
        UnauthorizedException
      );
    });

    it('should return board state successfully when PIN is valid', async () => {
      const selectedAt = new Date('2026-09-20T10:00:00.000Z');
      const dbBoard = {
        key: 'valid-key',
        letters: [{ letter: 'A', status: 'available' }],
        currentPartnerId: 10,
        currentLetter: 'Б',
        currentLetterSelectedAt: selectedAt,
        pin: 'pin-hash',
        partners: [
          { id: 10, name: 'Alice', turnOrder: 1, playerId: 2 },
          { id: 20, name: 'Bob', turnOrder: 2, playerId: 1 },
        ],
        history: [
          {
            letter: 'A',
            partnerId: 10,
            partner: { name: 'Alice', playerId: 2 },
            status: 'used',
            note: 'Cinema date',
            selectedAt: selectedAt,
            completedAt: selectedAt,
          },
        ],
      };

      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue(dbBoard);

      const result = await service.getBoardState('valid-key', 'pin-hash');
      expect(result).toEqual({
        success: true,
        letters: dbBoard.letters,
        history: [
          {
            letter: 'A',
            partnerId: 10,
            partnerName: 'Alice',
            playerId: 2,
            status: 'used',
            note: 'Cinema date',
            selectedAt: selectedAt,
            completedAt: selectedAt,
          },
        ],
        metadata: {
          partners: [
            { id: 10, name: 'Alice', playerId: 2 },
            { id: 20, name: 'Bob', playerId: 1 },
          ],
          currentPartnerId: 10,
          currentPartnerPlayerId: 2,
          currentLetter: 'Б',
          currentLetterSelectedAt: selectedAt,
          hasPin: true,
        },
      });
    });

    it('should return board state without PIN if board is not protected', async () => {
      const dbBoard = {
        key: 'unprotected-key',
        letters: [],
        pin: null,
        partners: [],
        history: [],
      };

      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue(dbBoard);

      const result = await service.getBoardState('unprotected-key');
      expect(result.success).toBe(true);
      expect(result.metadata.hasPin).toBe(false);
    });

    it('should return board state with photo in history', async () => {
      const dbBoard = {
        key: 'photo-board',
        letters: [{ letter: 'А', status: 'used', photo: 'https://blob.url/A.webp' }],
        pin: null,
        partners: [{ id: 1, name: 'Alice', playerId: 2, turnOrder: 1 }],
        history: [
          {
            letter: 'А',
            partnerId: 1,
            partner: { name: 'Alice', playerId: 2 },
            status: 'used',
            note: 'Romantic date',
            photo: 'https://blob.url/A.webp',
            selectedAt: new Date(),
            completedAt: new Date(),
          },
        ],
      };

      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue(dbBoard);

      const result = await service.getBoardState('photo-board');
      expect(result.letters[0].photo).toBe('https://blob.url/A.webp');
      expect(result.history[0].photo).toBe('https://blob.url/A.webp');
    });

    it('should serve board state from Redis cache on cache hit without querying Prisma', async () => {
      const cachedState = {
        response: {
          success: true,
          letters: [{ letter: 'A', status: 'available' }],
          history: [],
          metadata: {
            partners: [{ id: 1, name: 'Partner A', playerId: 1 }],
            currentPartnerId: 1,
            currentPartnerPlayerId: 1,
            currentLetter: null,
            currentLetterSelectedAt: null,
            hasPin: false,
          },
        },
        storedPin: null,
      };
      mockRedisReader.read.mockResolvedValue(cachedState);

      const result = await service.getBoardState('cached-key');

      expect(result).toEqual(cachedState.response);
      expect(mockRedisReader.read).toHaveBeenCalledWith('alphadate:board:cached-key');
      expect(mockPrismaService.alphadateBoard.findUnique).not.toHaveBeenCalled();
    });

    it('should verify PIN against cached storedPin on cache hit and reject if invalid', async () => {
      const cachedState = {
        response: {
          success: true,
          letters: [],
          history: [],
          metadata: {
            partners: [],
            currentPartnerId: null,
            currentPartnerPlayerId: null,
            currentLetter: null,
            currentLetterSelectedAt: null,
            hasPin: true,
          },
        },
        storedPin: '1234',
      };
      mockRedisReader.read.mockResolvedValue(cachedState);

      await expect(service.getBoardState('cached-key', 'wrong-pin')).rejects.toThrow(
        UnauthorizedException
      );
      expect(mockPrismaService.alphadateBoard.findUnique).not.toHaveBeenCalled();
    });

    it('should cache board state in Redis on cache miss', async () => {
      mockRedisReader.read.mockResolvedValue(null);
      const dbBoard = {
        key: 'valid-key',
        letters: [],
        partners: [],
        history: [],
        pin: null,
      };
      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue(dbBoard);

      await service.getBoardState('valid-key');

      expect(mockRedisReader.write).toHaveBeenCalledWith(
        'alphadate:board:valid-key',
        expect.objectContaining({
          response: expect.objectContaining({ success: true }),
          storedPin: null,
        }),
        86400
      );
    });

    it('should fallback to Prisma if Redis read throws an error', async () => {
      mockRedisReader.read.mockRejectedValue(new Error('Redis connection error'));
      const dbBoard = {
        key: 'fallback-key',
        letters: [],
        partners: [],
        history: [],
        pin: null,
      };
      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue(dbBoard);

      const result = await service.getBoardState('fallback-key');

      expect(result.success).toBe(true);
      expect(mockPrismaService.alphadateBoard.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { key: 'fallback-key' } })
      );
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
        { id: 1, name: 'Alice', turnOrder: 1, playerId: 2 },
        { id: 2, name: 'Bob', turnOrder: 2, playerId: 1 },
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
      expect(result.currentPartnerPlayerId).toBe(1);
      expect(result.partners).toEqual([
        { id: 1, name: 'Alice', playerId: 2 },
        { id: 2, name: 'Bob', playerId: 1 },
      ]);
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
        data: expect.objectContaining({ name: 'Alice Updated' }),
      });
      expect(mockPrismaService.alphadateBoard.update).toHaveBeenCalledWith({
        where: { key: 'key' },
        data: expect.objectContaining({ currentPartnerId: null }),
      });
      expect(mockPrismaService.alphadatePartner.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: [2] } },
      });
    });

    it('should hash and update pin when metadata.pin is updated', async () => {
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
          pin: '1234',
        },
      };

      const result = await service.updateBoardState('key', dto);
      expect(result.success).toBe(true);
      expect(mockPrismaService.alphadateBoard.update).toHaveBeenCalledWith({
        where: { key: 'key' },
        data: expect.objectContaining({ pin: expect.stringContaining(':') }),
      });
    });

    it('should throw UnauthorizedException when updating a protected board without PIN', async () => {
      const dbBoard = {
        key: 'key',
        letters: [],
        pin: 'pin-hash',
        currentPartnerId: 1,
      };

      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue(dbBoard);

      await expect(service.updateBoardState('key', { letters: [] })).rejects.toThrow(
        UnauthorizedException
      );
    });

    it('should allow updating protected board when valid PIN is provided', async () => {
      const dbBoard = {
        key: 'key',
        letters: [],
        pin: 'pin-hash',
        currentPartnerId: 1,
      };

      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue(dbBoard);
      mockPrismaService.alphadatePartner.findMany.mockResolvedValue([]);

      const result = await service.updateBoardState('key', { letters: [] }, 'pin-hash');
      expect(result.success).toBe(true);
    });

    it('should update currentLetter when currentLetter is provided', async () => {
      const dbBoard = {
        key: 'key',
        letters: [],
        currentPartnerId: 1,
      };

      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue(dbBoard);
      mockPrismaService.alphadatePartner.findMany.mockResolvedValue([]);

      const dto = {
        letters: [],
        currentLetter: 'Б',
      };

      const result = await service.updateBoardState('key', dto);
      expect(result.success).toBe(true);
      expect(mockPrismaService.alphadateBoard.update).toHaveBeenCalledWith({
        where: { key: 'key' },
        data: expect.objectContaining({ currentLetter: 'Б' }),
      });
      expect(mockRedisReader.delete).toHaveBeenCalledWith('alphadate:board:key');
    });

    it('should upload photo if data URL is provided and save blob url to letters and history', async () => {
      const dbBoard = {
        key: 'key',
        letters: [{ letter: 'А', status: 'available' }],
        currentPartnerId: 1,
        pin: null,
      };
      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue(dbBoard);
      mockPrismaService.alphadatePartner.findMany.mockResolvedValue([{ id: 1, turnOrder: 1 }]);

      const dto = {
        letters: [
          {
            letter: 'А',
            status: 'used' as const,
            note: 'Great date',
            photo: 'data:image/webp;base64,UklGRmIAAABXRUJQVlA4TFYAAAAvAAAAAAfQ//73v/+BiOh/AAA=',
          },
        ],
      };

      const result = await service.updateBoardState('key', dto);
      expect(result.success).toBe(true);
      expect(mockBlobService.upload).toHaveBeenCalledWith(
        'alphadate/key/%D0%90.webp',
        expect.any(Buffer),
        'image/webp'
      );
      expect(mockPrismaService.alphadateHistory.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            photo: 'https://blob.vercel-storage.com/alphadate/key/A.webp',
          }),
        })
      );
      expect(mockPrismaService.alphadateBoard.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            letters: [
              expect.objectContaining({
                photo: 'https://blob.vercel-storage.com/alphadate/key/A.webp',
              }),
            ],
          }),
        })
      );
    });

    it('should clean up old blob if photo is updated or replaced', async () => {
      const dbBoard = {
        key: 'key',
        letters: [
          {
            letter: 'А',
            status: 'used',
            note: 'Old note',
            photo: 'https://blob.vercel-storage.com/old-photo.webp',
          },
        ],
        currentPartnerId: 1,
        pin: null,
      };
      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue(dbBoard);
      mockPrismaService.alphadatePartner.findMany.mockResolvedValue([{ id: 1, turnOrder: 1 }]);

      const dto = {
        letters: [
          {
            letter: 'А',
            status: 'used' as const,
            note: 'Updated note',
            photo: 'data:image/webp;base64,UklGRmIAAABXRUJQVlA4TFYAAAAvAAAAAAfQ//73v/+BiOh/AAA=',
          },
        ],
      };

      await service.updateBoardState('key', dto);
      expect(mockBlobService.remove).toHaveBeenCalledWith(
        'https://blob.vercel-storage.com/old-photo.webp'
      );
    });

    it('should save partner and excluded status to history when a letter is excluded', async () => {
      const dbBoard = {
        key: 'key',
        letters: [
          {
            letter: 'Б',
            status: 'available',
          },
        ],
        currentPartnerId: 2,
        pin: null,
      };
      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue(dbBoard);
      mockPrismaService.alphadatePartner.findMany.mockResolvedValue([
        { id: 1, turnOrder: 1 },
        { id: 2, turnOrder: 2 },
      ]);

      const dto = {
        letters: [
          {
            letter: 'Б',
            status: 'excluded' as const,
            note: 'Not interested in bowling',
          },
        ],
      };

      const result = await service.updateBoardState('key', dto);
      expect(result.success).toBe(true);
      expect(mockPrismaService.alphadateHistory.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            boardId_letter: {
              boardId: 'key',
              letter: 'Б',
            },
          },
          create: expect.objectContaining({
            boardId: 'key',
            letter: 'Б',
            partnerId: 2,
            status: 'excluded',
            note: 'Not interested in bowling',
          }),
          update: expect.objectContaining({
            partnerId: 2,
            status: 'excluded',
            note: 'Not interested in bowling',
          }),
        })
      );
    });
  });

  describe('deleteBoard', () => {
    it('should throw NotFoundException if key not found', async () => {
      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue(null);

      await expect(service.deleteBoard('non-existent-key')).rejects.toThrow(NotFoundException);
    });

    it('should delete board successfully and clean up blobs', async () => {
      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue({
        key: 'to-delete',
        history: [
          { letter: 'А', photo: 'https://blob.vercel-storage.com/photo-1.webp' },
          { letter: 'Б', photo: null },
        ],
      });
      mockPrismaService.alphadateBoard.delete.mockResolvedValue({});

      const result = await service.deleteBoard('to-delete');
      expect(result).toEqual({ success: true });
      expect(mockPrismaService.alphadateBoard.delete).toHaveBeenCalledWith({
        where: { key: 'to-delete' },
      });
      expect(mockBlobService.remove).toHaveBeenCalledWith(
        'https://blob.vercel-storage.com/photo-1.webp'
      );
      expect(mockRedisReader.delete).toHaveBeenCalledWith('alphadate:board:to-delete');
    });
  });

  describe('getSuggestions', () => {
    it('should throw BadRequestException if key is missing or empty', async () => {
      await expect(service.getSuggestions('', 'А')).rejects.toThrow(BadRequestException);
      await expect(service.getSuggestions('   ', 'А')).rejects.toThrow(BadRequestException);
      await expect(service.getSuggestions(undefined as any, 'А')).rejects.toThrow(
        BadRequestException
      );
    });

    it('should throw BadRequestException if letter is missing or empty', async () => {
      await expect(service.getSuggestions('valid-key', '')).rejects.toThrow(BadRequestException);
      await expect(service.getSuggestions('valid-key', '   ')).rejects.toThrow(BadRequestException);
      await expect(service.getSuggestions('valid-key', undefined as any)).rejects.toThrow(
        BadRequestException
      );
    });

    it('should throw BadRequestException if letter length is not 1', async () => {
      await expect(service.getSuggestions('valid-key', 'AB')).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if letter is not an English or Ukrainian alphabet letter', async () => {
      await expect(service.getSuggestions('valid-key', '1')).rejects.toThrow(
        'Query parameter "letter" must be a valid English or Ukrainian alphabet letter'
      );
      await expect(service.getSuggestions('valid-key', '@')).rejects.toThrow(
        'Query parameter "letter" must be a valid English or Ukrainian alphabet letter'
      );
    });

    it('should throw ForbiddenException if board does not exist', async () => {
      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue(null);

      await expect(service.getSuggestions('non-existent-key', 'А')).rejects.toThrow(
        ForbiddenException
      );
      await expect(service.getSuggestions('non-existent-key', 'А')).rejects.toThrow(
        'Access denied: board not found or invalid'
      );
    });

    it('should auto-detect Cyrillic letter and return Ukrainian suggestions', async () => {
      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue({ key: 'valid-key' });
      mockLlmService.callAndParseJSON.mockResolvedValue({
        letter: 'А',
        suggestions: [
          {
            title: 'Аквапарк',
            description: 'Водні гірки та розваги',
            category: 'active',
            estimatedCost: 'moderate',
          },
        ],
      });

      const result = await service.getSuggestions('valid-key', 'а');

      expect(result.success).toBe(true);
      expect(result.letter).toBe('А');
      expect(result.lang).toBe('uk');
      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0].title).toBe('Аквапарк');
      expect(mockLlmService.callAndParseJSON).toHaveBeenCalledWith(
        expect.stringContaining('AlphaDate'),
        expect.stringContaining('«А»')
      );
    });

    it('should auto-detect Latin letter and return English suggestions', async () => {
      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue({ key: 'valid-key' });
      mockLlmService.callAndParseJSON.mockResolvedValue({
        letter: 'B',
        suggestions: [
          {
            title: 'Bowling',
            description: 'Fun bowling evening with delicious pizza.',
            category: 'active',
            estimatedCost: 'moderate',
          },
        ],
      });

      const result = await service.getSuggestions('valid-key', 'b');

      expect(result.success).toBe(true);
      expect(result.letter).toBe('B');
      expect(result.lang).toBe('en');
      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0].title).toBe('Bowling');
      expect(mockLlmService.callAndParseJSON).toHaveBeenCalledWith(
        expect.stringContaining('Alphabet Dating'),
        expect.stringContaining('"B"')
      );
    });

    it('should return empty suggestions array if AI returns no ideas for a letter', async () => {
      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue({ key: 'valid-key' });
      mockLlmService.callAndParseJSON.mockResolvedValue({
        letter: 'Ь',
        suggestions: [],
      });

      const result = await service.getSuggestions('valid-key', 'ь');

      expect(result.success).toBe(true);
      expect(result.letter).toBe('Ь');
      expect(result.lang).toBe('uk');
      expect(result.suggestions).toEqual([]);
    });

    it('should filter out suggestions that do not start with the specified letter', async () => {
      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue({ key: 'valid-key' });
      mockLlmService.callAndParseJSON.mockResolvedValue({
        letter: 'Є',
        suggestions: [
          {
            title: 'Єноти',
            description: 'Похід до контактного зоопарку',
            category: 'active',
            estimatedCost: 'moderate',
          },
          {
            title: 'Ялинка',
            description: 'Похід за ялинкою',
            category: 'active',
            estimatedCost: 'budget',
          },
        ],
      });

      const result = await service.getSuggestions('valid-key', 'є');

      expect(result.success).toBe(true);
      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0].title).toBe('Єноти');
    });

    it('should parse raw string array returned by AI', async () => {
      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue({ key: 'valid-key' });
      mockLlmService.callAndParseJSON.mockResolvedValue(['аквапарк', 'альтанка', 'боулінг']);

      const result = await service.getSuggestions('valid-key', 'а');

      expect(result.success).toBe(true);
      expect(result.letter).toBe('А');
      expect(result.suggestions).toHaveLength(2);
      expect(result.suggestions[0].title).toBe('аквапарк');
      expect(result.suggestions[1].title).toBe('альтанка');
    });

    it('should parse array of objects with title and description returned by AI', async () => {
      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue({ key: 'valid-key' });
      mockLlmService.callAndParseJSON.mockResolvedValue([
        {
          title: 'Аквапарк',
          description: 'Відвідайте водні атракціони та відпочиньте у джакузі.',
        },
      ]);

      const result = await service.getSuggestions('valid-key', 'а');

      expect(result.success).toBe(true);
      expect(result.letter).toBe('А');
      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0].title).toBe('Аквапарк');
      expect(result.suggestions[0].description).toBe(
        'Відвідайте водні атракціони та відпочиньте у джакузі.'
      );
      expect(result.suggestions[0].category).toBe('romantic');
      expect(result.suggestions[0].estimatedCost).toBe('moderate');
    });

    it('should throw HttpException with status 429 if AI fails due to rate limit', async () => {
      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue({ key: 'valid-key' });
      mockLlmService.callAndParseJSON.mockRejectedValue(
        new Error('Mistral 429 rate limit exceeded')
      );

      await expect(service.getSuggestions('valid-key', 'В')).rejects.toMatchObject({
        status: 429,
        message: expect.stringContaining('AI service rate limit exceeded'),
      });
    });

    it('should throw ServiceUnavailableException if AI fails due to timeout', async () => {
      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue({ key: 'valid-key' });
      mockLlmService.callAndParseJSON.mockRejectedValue(
        new Error('Request timed out after 30000ms')
      );

      await expect(service.getSuggestions('valid-key', 'Г')).rejects.toThrow(
        'AI service request timed out'
      );
    });

    it('should throw ServiceUnavailableException if AI fails due to general error', async () => {
      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue({ key: 'valid-key' });
      mockLlmService.callAndParseJSON.mockRejectedValue(new Error('Network connection failed'));

      await expect(service.getSuggestions('valid-key', 'Д')).rejects.toThrow(
        'Failed to get a response from AI service due to rate limits or temporary unavailability'
      );
    });
  });

  describe('recover', () => {
    it('should send email with board link when matching board exists and return success', async () => {
      mockPrismaService.alphadateBoard.findMany.mockResolvedValue([
        {
          key: 'abcde',
          email: 'user@example.com',
          partners: [{ name: 'Олена' }, { name: 'Андрій' }],
        },
      ]);

      const result = await service.recover({ email: 'User@Example.com' });

      expect(result).toEqual({ success: true });
      expect(mockPrismaService.alphadateBoard.findMany).toHaveBeenCalledWith({
        where: {
          email: {
            equals: 'user@example.com',
            mode: 'insensitive',
          },
        },
        include: {
          partners: {
            orderBy: {
              turnOrder: 'asc',
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });
      expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
        'User@Example.com',
        expect.stringContaining('Відновлення доступу до вашої дошки'),
        expect.stringContaining('http://localhost:3000/#/abcde')
      );
    });

    it('should list all boards in email when multiple boards exist for email', async () => {
      mockPrismaService.alphadateBoard.findMany.mockResolvedValue([
        {
          key: 'board1',
          email: 'user@example.com',
          partners: [{ name: 'Олена' }],
        },
        {
          key: 'board2',
          email: 'user@example.com',
          partners: [{ name: 'Марія' }, { name: 'Іван' }],
        },
      ]);

      const result = await service.recover({ email: 'user@example.com' });

      expect(result).toEqual({ success: true });
      expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
        'user@example.com',
        expect.stringContaining('дошок'),
        expect.stringContaining('http://localhost:3000/#/board1')
      );
      expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
        'user@example.com',
        expect.any(String),
        expect.stringContaining('http://localhost:3000/#/board2')
      );
    });

    it('should return success and not send email if no boards exist for email (prevent enumeration)', async () => {
      mockPrismaService.alphadateBoard.findMany.mockResolvedValue([]);

      const result = await service.recover({ email: 'nonexistent@example.com' });

      expect(result).toEqual({ success: true });
      expect(mockEmailService.sendEmail).not.toHaveBeenCalled();
    });

    it('should return success even if email sending throws an error', async () => {
      mockPrismaService.alphadateBoard.findMany.mockResolvedValue([
        {
          key: 'abcde',
          email: 'user@example.com',
          partners: [{ name: 'Олена' }],
        },
      ]);
      mockEmailService.sendEmail.mockRejectedValue(new Error('Resend network error'));

      const result = await service.recover({ email: 'user@example.com' });

      expect(result).toEqual({ success: true });
    });
  });

  describe('updateLetter', () => {
    it('should throw NotFoundException if board not found', async () => {
      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue(null);

      await expect(
        service.updateLetter('nonexistent', 'А', { note: 'test' })
      ).rejects.toThrow(NotFoundException);
    });

    it('should verify PIN access if board has PIN', async () => {
      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue({
        key: 'pinned-board',
        pin: '1234',
        letters: [{ letter: 'А', status: 'used' }],
      });

      await expect(
        service.updateLetter('pinned-board', 'А', { note: 'test' })
      ).rejects.toThrow(UnauthorizedException);

      await expect(
        service.updateLetter('pinned-board', 'А', { note: 'test' }, '0000')
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException if letter is not on board', async () => {
      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue({
        key: 'test-board',
        pin: null,
        letters: [{ letter: 'Б', status: 'used' }],
      });

      await expect(
        service.updateLetter('test-board', 'А', { note: 'test' })
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if letter is not used/completed', async () => {
      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue({
        key: 'test-board',
        pin: null,
        letters: [{ letter: 'А', status: 'available' }],
      });

      await expect(
        service.updateLetter('test-board', 'А', { note: 'test' })
      ).rejects.toThrow(BadRequestException);
    });

    it('should update note and photo for completed letter and clean up old blob', async () => {
      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue({
        key: 'test-board',
        pin: null,
        letters: [
          {
            letter: 'А',
            status: 'used',
            note: 'Старий коментар',
            photo: 'https://blob.vercel-storage.com/alphadate/test-board/old.webp',
          },
          { letter: 'Б', status: 'available' },
        ],
      });
      mockPrismaService.$transaction.mockImplementation(async cb => cb(mockPrismaService));
      mockBlobService.upload.mockResolvedValue(
        'https://blob.vercel-storage.com/alphadate/test-board/%D0%90.webp'
      );
      mockBlobService.remove.mockResolvedValue(undefined);

      const result = await service.updateLetter('test-board', 'А', {
        note: 'Новий оновлений коментар',
        photo: 'data:image/webp;base64,UklGRmIAAABXRUJQVlA4TFYAAAAvAAAAAAfQ//73v/+BiOh/AAA=',
      });

      expect(result.success).toBe(true);
      expect(result.letter).toBe('А');
      expect(result.note).toBe('Новий оновлений коментар');
      expect(result.photo).toBe(
        'https://blob.vercel-storage.com/alphadate/test-board/%D0%90.webp'
      );

      expect(mockBlobService.remove).toHaveBeenCalledWith(
        'https://blob.vercel-storage.com/alphadate/test-board/old.webp'
      );
      expect(mockPrismaService.alphadateBoard.update).toHaveBeenCalledWith({
        where: { key: 'test-board' },
        data: {
          letters: [
            {
              letter: 'А',
              status: 'used',
              note: 'Новий оновлений коментар',
              photo: 'https://blob.vercel-storage.com/alphadate/test-board/%D0%90.webp',
            },
            { letter: 'Б', status: 'available' },
          ],
        },
      });
      expect(mockPrismaService.alphadateHistory.updateMany).toHaveBeenCalledWith({
        where: {
          boardId: 'test-board',
          letter: 'А',
        },
        data: {
          note: 'Новий оновлений коментар',
          photo: 'https://blob.vercel-storage.com/alphadate/test-board/%D0%90.webp',
        },
      });
      expect(mockRedisReader.delete).toHaveBeenCalledWith('alphadate:board:test-board');
    });

    it('should allow clearing note and photo', async () => {
      mockPrismaService.alphadateBoard.findUnique.mockResolvedValue({
        key: 'test-board',
        pin: null,
        letters: [
          {
            letter: 'А',
            status: 'used',
            note: 'Старий коментар',
            photo: 'https://blob.vercel-storage.com/alphadate/test-board/old.webp',
          },
        ],
      });
      mockPrismaService.$transaction.mockImplementation(async cb => cb(mockPrismaService));
      mockBlobService.remove.mockResolvedValue(undefined);

      const result = await service.updateLetter('test-board', 'А', {
        note: null,
        photo: null,
      });

      expect(result.success).toBe(true);
      expect(result.note).toBeNull();
      expect(result.photo).toBeNull();
      expect(mockBlobService.remove).toHaveBeenCalledWith(
        'https://blob.vercel-storage.com/alphadate/test-board/old.webp'
      );
    });
  });
});
