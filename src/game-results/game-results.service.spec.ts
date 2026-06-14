import { Test, TestingModule } from '@nestjs/testing';
import { GameResultsService } from './game-results.service';
import { PrismaService } from '../models/prisma/prisma.service';
import { GameType } from '../models/enums/game-type.enum';

describe('GameResultsService', () => {
  let service: GameResultsService;
  let mockPrismaService: any;

  beforeEach(async () => {
    mockPrismaService = {
      gameResult: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GameResultsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<GameResultsService>(GameResultsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a new game result record', async () => {
      const dto = {
        gameType: GameType.STROOP,
        name: 'Player 1',
        result: 150,
        t: 'some-token',
      };
      mockPrismaService.gameResult.create.mockResolvedValue({ id: 1, ...dto });

      const result = await service.create(dto);

      expect(result).toEqual({ id: 1, ...dto });
      expect(mockPrismaService.gameResult.create).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.gameResult.create).toHaveBeenCalledWith({
        data: {
          gameType: dto.gameType,
          name: dto.name,
          result: dto.result,
        },
      });
    });
  });

  describe('findAll', () => {
    it('should return all game results ordered by createdAt desc', async () => {
      const mockList = [
        { id: 1, name: 'Player 1' },
        { id: 2, name: 'Player 2' },
      ];
      mockPrismaService.gameResult.findMany.mockResolvedValue(mockList);

      const result = await service.findAll();

      expect(result).toBe(mockList);
      expect(mockPrismaService.gameResult.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.gameResult.findMany).toHaveBeenCalledWith({
        orderBy: {
          createdAt: 'desc',
        },
      });
    });
  });

  describe('findLeaders', () => {
    it('should return leaders for a specific game type up to limit', async () => {
      const mockLeaders = [{ id: 1, result: 200 }];
      mockPrismaService.gameResult.findMany.mockResolvedValue(mockLeaders);

      const result = await service.findLeaders(GameType.STROOP);

      expect(result).toBe(mockLeaders);
      expect(mockPrismaService.gameResult.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.gameResult.findMany).toHaveBeenCalledWith({
        where: {
          gameType: GameType.STROOP,
        },
        orderBy: {
          result: 'desc',
        },
        take: 5,
      });
    });
  });

  describe('retokenize', () => {
    it('should correctly decode a valid encrypted token back to the original timestamp', () => {
      // Setup a specific test timestamp (e.g. 1770000000000)
      const timestamp = 1770000000000;
      const retokenValue = timestamp + 1654321; // 1770001654321

      // Pad to 16 characters: "001770001654321" (15 chars) -> "0001770001654321" (16 chars)
      const padded = String(retokenValue).padStart(16, '0');
      const X0 = padded.slice(0, 4); // "0001"
      const X1 = padded.slice(4, 8); // "7700"
      const X2 = padded.slice(8, 12); // "0165"
      const X3 = padded.slice(12, 16); // "4321"

      // retoken = parts[1] + parts[2] + parts[0] + parts[3]
      // We want parts[1] = X0, parts[2] = X1, parts[0] = X2, parts[3] = X3
      // Hence, token = parts[0] + parts[1] + parts[2] + parts[3] = X2 + X0 + X1 + X3
      const token = X2 + X0 + X1 + X3; // "0165000177004321"

      // Base64 encode the token string
      const b64Token = btoa(token);

      const decoded = service.retokenize(b64Token);

      expect(decoded).toBe(timestamp);
    });
  });
});
