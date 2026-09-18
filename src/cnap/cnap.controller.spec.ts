import { Test, TestingModule } from '@nestjs/testing';
import { CnapController } from './cnap.controller';
import { CnapService } from './cnap.service';
import { CnapCheckResponse } from './interfaces/cnap.interface';

describe('CnapController', () => {
  let controller: CnapController;
  let mockCnapService: jest.Mocked<Partial<CnapService>>;

  const mockResponse: CnapCheckResponse = {
    success: true,
    hasSlots: true,
    category: 'Паспортні послуги',
    targetLocation: 'Хвильового',
    telegramQueued: true,
    message: 'Знайдено слоти',
    report: 'report content',
    data: {
      category: 'Паспортні послуги',
      targetLocation: 'Хвильового',
      hasSlots: true,
      services: [],
      message: 'Знайдено слоти',
    },
  };

  beforeEach(async () => {
    mockCnapService = {
      checkAndNotify: jest.fn().mockResolvedValue(mockResponse),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CnapController],
      providers: [
        {
          provide: CnapService,
          useValue: mockCnapService,
        },
      ],
    }).compile();

    controller = module.get<CnapController>(CnapController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('checkSlotsGet', () => {
    it('should call service with all provided query parameters', async () => {
      const result = await controller.checkSlotsGet(
        'Категорія 1',
        'Послуга 1',
        'Хвильового',
        'true',
        'true',
        '12345'
      );

      expect(result).toEqual(mockResponse);
      expect(mockCnapService.checkAndNotify).toHaveBeenCalledWith({
        category: 'Категорія 1',
        service: 'Послуга 1',
        location: 'Хвильового',
        notify: 'true',
        force: 'true',
        chatId: '12345',
      });
    });

    it('should call service with undefined query parameters', async () => {
      const result = await controller.checkSlotsGet();

      expect(result).toEqual(mockResponse);
      expect(mockCnapService.checkAndNotify).toHaveBeenCalledWith({
        category: undefined,
        service: undefined,
        location: undefined,
        notify: undefined,
        force: undefined,
        chatId: undefined,
      });
    });
  });

  describe('checkSlotsPost', () => {
    it('should call service with provided query parameters', async () => {
      const result = await controller.checkSlotsPost(
        'Категорія 2',
        'Послуга 2',
        'Шевченка',
        'always',
        'false',
        '67890'
      );

      expect(result).toEqual(mockResponse);
      expect(mockCnapService.checkAndNotify).toHaveBeenCalledWith({
        category: 'Категорія 2',
        service: 'Послуга 2',
        location: 'Шевченка',
        notify: 'always',
        force: 'false',
        chatId: '67890',
      });
    });

    it('should call service with undefined query parameters', async () => {
      const result = await controller.checkSlotsPost();

      expect(result).toEqual(mockResponse);
      expect(mockCnapService.checkAndNotify).toHaveBeenCalledWith({
        category: undefined,
        service: undefined,
        location: undefined,
        notify: undefined,
        force: undefined,
        chatId: undefined,
      });
    });
  });
});
