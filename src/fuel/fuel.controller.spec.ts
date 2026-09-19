import { Test, TestingModule } from '@nestjs/testing';
import { FuelController } from './fuel.controller';
import { FuelService } from './fuel.service';
import { FuelHistoryResponse, FuelPricesResponse } from './interfaces/fuel-prices.interface';

describe('FuelController', () => {
  let controller: FuelController;
  let mockFuelService: jest.Mocked<Partial<FuelService>>;

  const mockResponse: FuelPricesResponse = {
    requestedDate: '2026-09-11',
    effectiveDate: '2026-09-11',
    isFallback: false,
    currency: 'UAH',
    unit: 'грн/л',
    prices: {
      a95Premium: 87.42,
      a95: 83.96,
      a92: 79.69,
      diesel: 94.63,
      gas: 43.44,
    },
    source: 'https://index.minfin.com.ua/ua/markets/fuel/2026-09/',
  };

  const mockHistoryResponse: FuelHistoryResponse = {
    startDate: '2026-08-21',
    endDate: '2026-09-19',
    days: 30,
    currency: 'UAH',
    unit: 'грн/л',
    items: [
      {
        date: '2026-09-11',
        prices: {
          a95Premium: 87.42,
          a95: 83.96,
          a92: 79.69,
          diesel: 94.63,
          gas: 43.44,
        },
      },
    ],
    source: 'https://index.minfin.com.ua/ua/markets/fuel/',
  };

  beforeEach(async () => {
    mockFuelService = {
      getPrices: jest.fn(),
      getHistory: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FuelController],
      providers: [
        {
          provide: FuelService,
          useValue: mockFuelService,
        },
      ],
    }).compile();

    controller = module.get<FuelController>(FuelController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getPrices', () => {
    it('should return fuel prices from service with provided date', async () => {
      mockFuelService.getPrices.mockResolvedValue(mockResponse);

      const result = await controller.getPrices('2026-09-11');

      expect(result).toEqual(mockResponse);
      expect(mockFuelService.getPrices).toHaveBeenCalledWith('2026-09-11');
    });

    it('should return fuel prices without date', async () => {
      mockFuelService.getPrices.mockResolvedValue(mockResponse);

      const result = await controller.getPrices();

      expect(result).toEqual(mockResponse);
      expect(mockFuelService.getPrices).toHaveBeenCalledWith(undefined);
    });
  });

  describe('getPricesAlias', () => {
    it('should return fuel prices for /prices endpoint alias', async () => {
      mockFuelService.getPrices.mockResolvedValue(mockResponse);

      const result = await controller.getPricesAlias('2026-09-11');

      expect(result).toEqual(mockResponse);
      expect(mockFuelService.getPrices).toHaveBeenCalledWith('2026-09-11');
    });
  });

  describe('getHistory', () => {
    it('should delegate getHistory with query params to fuelService', async () => {
      mockFuelService.getHistory.mockResolvedValue(mockHistoryResponse);

      const result = await controller.getHistory('2026-09-19', '14', '2026-09-06');

      expect(result).toEqual(mockHistoryResponse);
      expect(mockFuelService.getHistory).toHaveBeenCalledWith({
        endDate: '2026-09-19',
        days: '14',
        startDate: '2026-09-06',
      });
    });

    it('should delegate getHistory with no query params', async () => {
      mockFuelService.getHistory.mockResolvedValue(mockHistoryResponse);

      const result = await controller.getHistory();

      expect(result).toEqual(mockHistoryResponse);
      expect(mockFuelService.getHistory).toHaveBeenCalledWith({
        endDate: undefined,
        days: undefined,
        startDate: undefined,
      });
    });
  });
});
