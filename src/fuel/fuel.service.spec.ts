import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { FuelService } from './fuel.service';

describe('FuelService', () => {
  let service: FuelService;

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
    const module: TestingModule = await Test.createTestingModule({
      providers: [FuelService],
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
  });
});
