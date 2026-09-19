import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FuelService } from './fuel.service';
import { RedisReader } from '../common/helpers/redisReader';

describe('FuelService', () => {
  let service: FuelService;
  let mockRedisReader: jest.Mocked<Partial<RedisReader>>;

  const sampleHtmlSeptember = `
    <html>
      <body>
        <table class="zebra">
          <tr>
            <th>Дата</th>
            <th>А 95+</th>
            <th>А 95</th>
            <th>А 92</th>
            <th>ДП</th>
            <th>ДП+</th>
            <th>Газ</th>
          </tr>
          <tr>
            <td>01.09.2026</td>
            <td>84,03</td>
            <td>80,32</td>
            <td>76,87</td>
            <td>91,41</td>
            <td>-</td>
            <td>43,06</td>
          </tr>
          <tr>
            <td>04.09.2026</td>
            <td>85,17</td>
            <td>82,00</td>
            <td>77,86</td>
            <td>92,40</td>
            <td>-</td>
            <td>43,38</td>
          </tr>
          <tr>
            <td>07.09.2026</td>
            <td>85,99</td>
            <td>82,22</td>
            <td>78,64</td>
            <td>92,63</td>
            <td>-</td>
            <td>43,41</td>
          </tr>
        </table>
      </body>
    </html>
  `;

  const sampleHtmlAugust = `
    <html>
      <body>
        <table class="zebra">
          <tr>
            <th>Дата</th>
            <th>А 95+</th>
            <th>А 95</th>
            <th>А 92</th>
            <th>ДП</th>
            <th>Газ</th>
          </tr>
          <tr>
            <td>31.08.2026</td>
            <td>83,85</td>
            <td>80,07</td>
            <td>76,90</td>
            <td>91,53</td>
            <td>43,07</td>
          </tr>
        </table>
      </body>
    </html>
  `;

  beforeEach(async () => {
    mockRedisReader = {
      read: jest.fn().mockResolvedValue(null),
      write: jest.fn().mockResolvedValue({} as any),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FuelService,
        {
          provide: RedisReader,
          useValue: mockRedisReader,
        },
      ],
    }).compile();

    service = module.get<FuelService>(FuelService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getPrices', () => {
    it('should return exact match when target date is found in table', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => sampleHtmlSeptember,
      } as Response);

      const result = await service.getPrices('2026-09-04');

      expect(result).toEqual({
        requestedDate: '2026-09-04',
        effectiveDate: '2026-09-04',
        isFallback: false,
        currency: 'UAH',
        unit: 'грн/л',
        prices: {
          a95Premium: 85.17,
          a95: 82,
          a92: 77.86,
          diesel: 92.4,
          gas: 43.38,
        },
        delta: {
          a95Premium: 1.14,
          a95: 1.68,
          a92: 0.99,
          diesel: 0.99,
          gas: 0.32,
        },
        source: 'https://index.minfin.com.ua/ua/markets/fuel/2026-09/',
      });
    });

    it('should fallback to previous trading day in the same month for weekend', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => sampleHtmlSeptember,
      } as Response);

      // 2026-09-05 is Saturday, closest previous trading day is 2026-09-04
      const result = await service.getPrices('2026-09-05');

      expect(result.requestedDate).toBe('2026-09-05');
      expect(result.effectiveDate).toBe('2026-09-04');
      expect(result.isFallback).toBe(true);
      expect(result.prices.a95).toBe(82);
    });

    it('should fallback to previous month if date is before first trading day in current month', async () => {
      // First call for September returns table starting on 01.09, but suppose requested date was 2026-09-01 before table or empty
      const emptySeptemberTable = `
        <html><body><table class="zebra"><tr><th>Дата</th><th>А 95</th></tr><tr><td>03.09.2026</td><td>85,00</td></tr></table></body></html>
      `;

      jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => emptySeptemberTable,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => sampleHtmlAugust,
        } as Response);

      // 2026-09-01 is before 2026-09-03
      const result = await service.getPrices('2026-09-01');

      expect(result.requestedDate).toBe('2026-09-01');
      expect(result.effectiveDate).toBe('2026-08-31');
      expect(result.isFallback).toBe(true);
      expect(result.prices.a95).toBe(80.07);
    });

    it('should reject invalid date format', async () => {
      await expect(service.getPrices('invalid-date')).rejects.toThrow(BadRequestException);
      await expect(service.getPrices('2026/09/01')).rejects.toThrow(BadRequestException);
    });

    it('should reject date before June 2015', async () => {
      await expect(service.getPrices('2014-12-31')).rejects.toThrow(BadRequestException);
    });

    it('should reject future dates', async () => {
      await expect(service.getPrices('2099-01-01')).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if month returns 404', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as Response);

      await expect(service.getPrices('2020-01-15')).rejects.toThrow(NotFoundException);
    });

    it('should throw Error if fetch fails with non-404 error', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Server Error',
      } as Response);

      await expect(service.getPrices('2020-01-15')).rejects.toThrow(
        'Failed to fetch data from Minfin'
      );
    });

    it('should use today date if no date parameter is provided', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => sampleHtmlSeptember,
      } as Response);

      const result = await service.getPrices();

      expect(result).toBeDefined();
      expect(result.currency).toBe('UAH');
      expect(result.unit).toBe('грн/л');
    });

    it('should return cached prices if available in Redis without calling fetch', async () => {
      const cachedData = {
        requestedDate: '2026-09-04',
        effectiveDate: '2026-09-04',
        isFallback: false,
        currency: 'UAH',
        unit: 'грн/л',
        prices: { a95: 82.0 },
        source: 'https://index.minfin.com.ua/ua/markets/fuel/2026-09/',
      };
      mockRedisReader.read.mockResolvedValueOnce(cachedData);
      const fetchSpy = jest.spyOn(global, 'fetch');

      const result = await service.getPrices('2026-09-04');

      expect(result).toEqual(cachedData);
      expect(mockRedisReader.read).toHaveBeenCalledWith('fuel-prices-2026-09-04');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should save fetched prices to Redis cache', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => sampleHtmlSeptember,
      } as Response);

      await service.getPrices('2026-09-04');

      expect(mockRedisReader.write).toHaveBeenCalledWith(
        'fuel-prices-2026-09-04',
        expect.objectContaining({
          requestedDate: '2026-09-04',
          effectiveDate: '2026-09-04',
        })
      );
    });
  });

  describe('getHistory', () => {
    it('should fetch history with default parameters (today and 30 days)', async () => {
      jest.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
        const urlStr = url.toString();
        if (urlStr.includes('2026-09')) {
          return {
            ok: true,
            status: 200,
            text: async () => sampleHtmlSeptember,
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          text: async () => sampleHtmlAugust,
        } as Response;
      });

      const result = await service.getHistory();

      expect(result).toBeDefined();
      expect(result.days).toBe(30);
      expect(result.currency).toBe('UAH');
      expect(result.unit).toBe('грн/л');
      expect(result.source).toBe('https://index.minfin.com.ua/ua/markets/fuel/');
      expect(Array.isArray(result.items)).toBe(true);
    });

    it('should fetch history for explicit endDate and days within single month', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => sampleHtmlSeptember,
      } as Response);

      const result = await service.getHistory({
        endDate: '2026-09-07',
        days: 7,
      });

      expect(result.startDate).toBe('2026-09-01');
      expect(result.endDate).toBe('2026-09-07');
      expect(result.days).toBe(7);
      expect(result.items).toHaveLength(3);
      expect(result.items[0].date).toBe('2026-09-01');
      expect(result.items[1].date).toBe('2026-09-04');
      expect(result.items[2].date).toBe('2026-09-07');
      expect(result.items[0].prices.a95).toBe(80.32);
      expect(result.items[1].delta).toEqual({
        a95Premium: 1.14,
        a95: 1.68,
        a92: 0.99,
        diesel: 0.99,
        gas: 0.32,
      });
    });

    it('should fetch history spanning across two months and sort items chronologically', async () => {
      jest.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
        const urlStr = url.toString();
        if (urlStr.includes('2026-09')) {
          return {
            ok: true,
            status: 200,
            text: async () => sampleHtmlSeptember,
          } as Response;
        }
        if (urlStr.includes('2026-08')) {
          return {
            ok: true,
            status: 200,
            text: async () => sampleHtmlAugust,
          } as Response;
        }
        return {
          ok: false,
          status: 404,
          statusText: 'Not Found',
        } as Response;
      });

      const result = await service.getHistory({
        startDate: '2026-08-30',
        endDate: '2026-09-04',
      });

      expect(result.startDate).toBe('2026-08-30');
      expect(result.endDate).toBe('2026-09-04');
      expect(result.days).toBe(6);
      expect(result.items).toHaveLength(3);
      expect(result.items[0].date).toBe('2026-08-31');
      expect(result.items[1].date).toBe('2026-09-01');
      expect(result.items[2].date).toBe('2026-09-04');
      expect(result.items[1].delta).toEqual({
        a95Premium: 0.18,
        a95: 0.25,
        a92: -0.03,
        diesel: -0.12,
        gas: -0.01,
      });
    });

    it('should reject if days exceeds 30', async () => {
      await expect(
        service.getHistory({
          endDate: '2026-09-10',
          days: 31,
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject if days is less than 1 or not an integer', async () => {
      await expect(
        service.getHistory({
          endDate: '2026-09-10',
          days: 0,
        })
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.getHistory({
          endDate: '2026-09-10',
          days: 'abc',
        })
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.getHistory({
          endDate: '2026-09-10',
          days: 5.5,
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject if interval between startDate and endDate exceeds 30 days', async () => {
      await expect(
        service.getHistory({
          startDate: '2026-08-01',
          endDate: '2026-09-05',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject if startDate is after endDate', async () => {
      await expect(
        service.getHistory({
          startDate: '2026-09-15',
          endDate: '2026-09-10',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject invalid startDate or endDate format', async () => {
      await expect(
        service.getHistory({
          startDate: 'invalid-date',
          endDate: '2026-09-10',
        })
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.getHistory({
          startDate: '2026-09-01',
          endDate: 'invalid-date',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject future startDate or endDate', async () => {
      await expect(
        service.getHistory({
          endDate: '2099-01-01',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject startDate before June 2015', async () => {
      await expect(
        service.getHistory({
          startDate: '2015-05-30',
          endDate: '2015-06-05',
        })
      ).rejects.toThrow(BadRequestException);
    });

    it('should handle 404 for a month gracefully by treating it as empty', async () => {
      jest.spyOn(global, 'fetch').mockImplementation(async (url: string) => {
        const urlStr = url.toString();
        if (urlStr.includes('2026-09')) {
          return {
            ok: true,
            status: 200,
            text: async () => sampleHtmlSeptember,
          } as Response;
        }
        return {
          ok: false,
          status: 404,
          statusText: 'Not Found',
        } as Response;
      });

      const result = await service.getHistory({
        startDate: '2026-08-30',
        endDate: '2026-09-04',
      });

      expect(result.items).toHaveLength(2);
      expect(result.items[0].date).toBe('2026-09-01');
      expect(result.items[1].date).toBe('2026-09-04');
    });

    it('should rethrow non-404 fetch errors', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Server Error',
      } as Response);

      await expect(
        service.getHistory({
          startDate: '2026-09-01',
          endDate: '2026-09-05',
        })
      ).rejects.toThrow('Failed to fetch data from Minfin');
    });

    it('should return cached history if available in Redis without calling fetch', async () => {
      const cachedHistory = {
        startDate: '2026-09-01',
        endDate: '2026-09-04',
        days: 4,
        currency: 'UAH',
        unit: 'грн/л',
        items: [{ date: '2026-09-01', prices: { a95: 80.32 } }],
        source: 'https://index.minfin.com.ua/ua/markets/fuel/',
      };
      mockRedisReader.read.mockResolvedValueOnce(cachedHistory);
      const fetchSpy = jest.spyOn(global, 'fetch');

      const result = await service.getHistory({
        startDate: '2026-09-01',
        endDate: '2026-09-04',
      });

      expect(result).toEqual(cachedHistory);
      expect(mockRedisReader.read).toHaveBeenCalledWith('fuel-history-2026-09-01-2026-09-04');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('should save computed history to Redis cache for completed periods', async () => {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => sampleHtmlSeptember,
      } as Response);

      await service.getHistory({
        startDate: '2026-09-01',
        endDate: '2026-09-04',
      });

      expect(mockRedisReader.write).toHaveBeenCalledWith(
        'fuel-history-2026-09-01-2026-09-04',
        expect.objectContaining({
          startDate: '2026-09-01',
          endDate: '2026-09-04',
          days: 4,
        })
      );
    });
  });
});
