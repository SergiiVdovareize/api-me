import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { GameResultsController } from './game-results.controller';
import { GameResultsService } from './game-results.service';
import { GameType } from '../models/enums/game-type.enum';

describe('GameResultsController', () => {
  let controller: GameResultsController;
  let mockGameResultsService: jest.Mocked<Partial<GameResultsService>>;

  beforeEach(async () => {
    mockGameResultsService = {
      retokenize: jest.fn(),
      create: jest.fn(),
      findAll: jest.fn(),
      findLeaders: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GameResultsController],
      providers: [
        {
          provide: GameResultsService,
          useValue: mockGameResultsService,
        },
      ],
    }).compile();

    controller = module.get<GameResultsController>(GameResultsController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should create a record and return success if token is valid and active', async () => {
      const dto = {
        gameType: GameType.STROOP,
        name: 'Player 1',
        result: 100,
        t: 'valid-token',
      };
      mockGameResultsService.retokenize.mockReturnValue(Date.now());
      mockGameResultsService.create.mockResolvedValue({ id: 123 } as any);

      const result = await controller.create(dto);

      expect(result).toEqual({ success: true });
      expect(mockGameResultsService.retokenize).toHaveBeenCalledWith('valid-token');
      expect(mockGameResultsService.create).toHaveBeenCalledWith(dto);
    });

    it('should throw BadRequestException if token has expired', async () => {
      const dto = {
        gameType: GameType.STROOP,
        name: 'Player 1',
        result: 100,
        t: 'expired-token',
      };
      // Token is 20 seconds old
      mockGameResultsService.retokenize.mockReturnValue(Date.now() - 20000);

      await expect(controller.create(dto)).rejects.toThrow(
        new BadRequestException('Request expired')
      );
    });

    it('should throw BadRequestException if token is invalid format', async () => {
      const dto = {
        gameType: GameType.STROOP,
        name: 'Player 1',
        result: 100,
        t: 'invalid-b64-token',
      };
      mockGameResultsService.retokenize.mockImplementation(() => {
        throw new Error('Invalid btoa');
      });

      await expect(controller.create(dto)).rejects.toThrow(
        new BadRequestException('Invalid token format')
      );
    });
  });

  describe('findAll', () => {
    it('should return all results from the service', async () => {
      const mockData = [{ id: 1, name: 'P1' }];
      mockGameResultsService.findAll.mockResolvedValue(mockData as any);

      const result = await controller.findAll();

      expect(result).toBe(mockData);
      expect(mockGameResultsService.findAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('getLeaders', () => {
    it('should return leaderboards from the service', async () => {
      const mockLeaders = [{ id: 1, result: 100 }];
      mockGameResultsService.findLeaders.mockResolvedValue(mockLeaders as any);

      const result = await controller.getLeaders(GameType.STROOP);

      expect(result).toBe(mockLeaders);
      expect(mockGameResultsService.findLeaders).toHaveBeenCalledWith(GameType.STROOP);
    });
  });
});
