import { Test, TestingModule } from '@nestjs/testing';
import { DateController } from './date.controller';
import { DateService } from './date.service';

describe('DateController', () => {
  let controller: DateController;
  let mockDateService: jest.Mocked<Partial<DateService>>;

  beforeEach(async () => {
    mockDateService = {
      getRandomDate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DateController],
      providers: [
        {
          provide: DateService,
          useValue: mockDateService,
        },
      ],
    }).compile();

    controller = module.get<DateController>(DateController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getRandomDate', () => {
    it('should return success and the date when date is found', async () => {
      mockDateService.getRandomDate.mockResolvedValue('10.10.2020');

      const result = await controller.getRandomDate();

      expect(result).toEqual({ success: true, date: '10.10.2020' });
      expect(mockDateService.getRandomDate).toHaveBeenCalledTimes(1);
    });

    it('should return success false and date null when date is not found', async () => {
      mockDateService.getRandomDate.mockResolvedValue(null);

      const result = await controller.getRandomDate();

      expect(result).toEqual({ success: false, date: null });
      expect(mockDateService.getRandomDate).toHaveBeenCalledTimes(1);
    });
  });
});
