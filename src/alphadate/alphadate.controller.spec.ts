import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AlphadateController } from './alphadate.controller';
import { AlphadateService } from './alphadate.service';

describe('AlphadateController', () => {
  let controller: AlphadateController;
  let service: jest.Mocked<AlphadateService>;

  beforeEach(async () => {
    const mockService = {
      create: jest.fn(),
      getBoardState: jest.fn(),
      updateBoardState: jest.fn(),
      deleteBoard: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AlphadateController],
      providers: [
        {
          provide: AlphadateService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<AlphadateController>(AlphadateController);
    service = module.get(AlphadateService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should call service.create and return response', async () => {
      const dto = { email: 'a@b.com', partners: ['A'] };
      service.create.mockResolvedValue({ key: 'abcde' } as any);

      const result = await controller.create(dto);
      expect(result).toEqual({ success: true, key: 'abcde' });
      expect(service.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('getBoardState', () => {
    it('should call service.getBoardState and return response', async () => {
      service.getBoardState.mockResolvedValue({ success: true, letters: [] } as any);

      const result = await controller.getBoardState('abcde');
      expect(result).toEqual({ success: true, letters: [] });
      expect(service.getBoardState).toHaveBeenCalledWith('abcde');
    });
  });

  describe('updateBoardState', () => {
    it('should throw BadRequestException if body is not an object', async () => {
      await expect(controller.updateBoardState('key', null)).rejects.toThrow(BadRequestException);
      await expect(controller.updateBoardState('key', 'invalid')).rejects.toThrow(
        BadRequestException
      );
    });

    it('should throw BadRequestException if letters is not an array', async () => {
      await expect(controller.updateBoardState('key', { letters: {} })).rejects.toThrow(
        BadRequestException
      );
    });

    it('should throw BadRequestException if a letter item is not an object', async () => {
      await expect(
        controller.updateBoardState('key', { letters: ['not-an-object'] })
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if a letter item misses a non-empty letter string', async () => {
      await expect(
        controller.updateBoardState('key', { letters: [{ letter: ' ', status: 'available' }] })
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if a letter item has an invalid status', async () => {
      await expect(
        controller.updateBoardState('key', { letters: [{ letter: 'A', status: 'invalid-status' }] })
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if metadata is an array', async () => {
      const payload = {
        letters: [{ letter: 'A', status: 'used' }],
        metadata: ['Alice', 'Bob'], // array instead of object
      };
      await expect(controller.updateBoardState('key', payload)).rejects.toThrow(
        BadRequestException
      );
    });

    it('should throw BadRequestException if currentLetter is a multi-character string', async () => {
      const payload = {
        letters: [{ letter: 'A', status: 'used' }],
        currentLetter: 'AB',
      };
      await expect(controller.updateBoardState('key', payload)).rejects.toThrow(
        BadRequestException
      );
    });

    it('should throw BadRequestException if currentLetter is not a string or null', async () => {
      const payload = {
        letters: [{ letter: 'A', status: 'used' }],
        currentLetter: 123,
      };
      await expect(controller.updateBoardState('key', payload)).rejects.toThrow(
        BadRequestException
      );
    });

    it('should successfully update board state with valid payload including currentLetter', async () => {
      const payload = {
        letters: [{ letter: 'A', status: 'used' }],
        currentLetter: 'Б',
      };

      service.updateBoardState.mockResolvedValue({ currentPartnerId: 2 } as any);

      const result = await controller.updateBoardState('key', payload);
      expect(result).toEqual({ success: true, currentPartnerId: 2 });
      expect(service.updateBoardState).toHaveBeenCalledWith('key', {
        letters: [{ letter: 'A', status: 'used' }],
        currentLetter: 'Б',
      });
    });

    it('should successfully update board state with valid payload', async () => {
      const payload = {
        letters: [{ letter: 'A', status: 'used' }],
        metadata: {
          partners: ['Alice', 'Bob'],
          pinHash: 'hash',
        },
      };

      service.updateBoardState.mockResolvedValue({ currentPartnerId: 2 } as any);

      const result = await controller.updateBoardState('key', payload);
      expect(result).toEqual({ success: true, currentPartnerId: 2 });
      expect(service.updateBoardState).toHaveBeenCalledWith('key', {
        letters: [{ letter: 'A', status: 'used' }],
        metadata: {
          partners: ['Alice', 'Bob'],
          pinHash: 'hash',
        },
      });
    });
  });

  describe('deleteBoard', () => {
    it('should call service.deleteBoard and return response', async () => {
      service.deleteBoard.mockResolvedValue({ success: true });

      const result = await controller.deleteBoard('key');
      expect(result).toEqual({ success: true });
      expect(service.deleteBoard).toHaveBeenCalledWith('key');
    });
  });
});
