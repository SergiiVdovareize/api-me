import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as cheerio from 'cheerio';
import {
  FuelHistoryItem,
  FuelHistoryResponse,
  FuelPrices,
  FuelPricesResponse,
} from './interfaces/fuel-prices.interface';
import { RedisReader } from '../common/helpers/redisReader';

interface DailyFuelEntry {
  date: string; // YYYY-MM-DD
  prices: FuelPrices;
}

@Injectable()
export class FuelService {
  private readonly logger = new Logger(FuelService.name);
  private readonly baseUrl = 'https://index.minfin.com.ua/ua/markets/fuel/';

  constructor(private readonly redisReader: RedisReader) {}

  async getPrices(requestedDate?: string): Promise<FuelPricesResponse> {
    const today = this.getTodayDateKyiv();
    const targetDate = requestedDate || today;

    this.validateDate(targetDate);

    const cacheKey = `fuel-prices-${targetDate}`;
    try {
      const cached = await this.redisReader.read(cacheKey);
      if (cached) {
        return cached;
      }
    } catch (err) {
      this.logger.warn(`Failed to read cache for ${cacheKey}: ${err.message}`);
    }

    const [year, month] = targetDate.split('-');
    const monthEntries = await this.fetchMonthEntries(year, month);

    // Exact match for the target date
    const exactMatch = monthEntries.find(entry => entry.date === targetDate);
    if (exactMatch) {
      const prevEntry = await this.getPreviousDailyEntry(exactMatch.date, monthEntries);
      const delta = this.calculateDelta(exactMatch.prices, prevEntry?.prices);
      const response: FuelPricesResponse = {
        requestedDate: targetDate,
        effectiveDate: exactMatch.date,
        isFallback: false,
        currency: 'UAH',
        unit: 'грн/л',
        prices: exactMatch.prices,
        delta,
        source: `${this.baseUrl}${year}-${month}/`,
      };
      await this.safeCacheWrite(cacheKey, response);
      return response;
    }

    // Look for previous available day in the same month
    const previousInMonth = monthEntries
      .filter(entry => entry.date <= targetDate)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (previousInMonth.length > 0) {
      const fallback = previousInMonth[previousInMonth.length - 1];
      const prevEntry = await this.getPreviousDailyEntry(fallback.date, monthEntries);
      const delta = this.calculateDelta(fallback.prices, prevEntry?.prices);
      const response: FuelPricesResponse = {
        requestedDate: targetDate,
        effectiveDate: fallback.date,
        isFallback: true,
        currency: 'UAH',
        unit: 'грн/л',
        prices: fallback.prices,
        delta,
        source: `${this.baseUrl}${year}-${month}/`,
      };
      if (targetDate !== today) {
        await this.safeCacheWrite(cacheKey, response);
      }
      return response;
    }

    // If target date is earlier than the first available date in this month (e.g. 1st or 2nd is weekend),
    // fetch the previous month's data and use the last available day
    const prevMonthStr = this.getPreviousMonth(year, month);
    if (prevMonthStr) {
      const [prevYear, prevM] = prevMonthStr.split('-');
      try {
        const prevMonthEntries = await this.fetchMonthEntries(prevYear, prevM);
        if (prevMonthEntries.length > 0) {
          prevMonthEntries.sort((a, b) => a.date.localeCompare(b.date));
          const fallback = prevMonthEntries[prevMonthEntries.length - 1];
          const prevEntry = await this.getPreviousDailyEntry(fallback.date, prevMonthEntries);
          const delta = this.calculateDelta(fallback.prices, prevEntry?.prices);
          const response: FuelPricesResponse = {
            requestedDate: targetDate,
            effectiveDate: fallback.date,
            isFallback: true,
            currency: 'UAH',
            unit: 'грн/л',
            prices: fallback.prices,
            delta,
            source: `${this.baseUrl}${prevYear}-${prevM}/`,
          };
          if (targetDate !== today) {
            await this.safeCacheWrite(cacheKey, response);
          }
          return response;
        }
      } catch (err) {
        this.logger.warn(`Could not fetch previous month ${prevMonthStr}: ${err.message}`);
      }
    }

    throw new NotFoundException(`Fuel price data not found for ${targetDate}`);
  }

  async getHistory(
    options: {
      endDate?: string;
      days?: number | string;
      startDate?: string;
    } = {}
  ): Promise<FuelHistoryResponse> {
    const today = this.getTodayDateKyiv();
    const endDate = options.endDate || today;
    this.validateDate(endDate, 'endDate');

    let startDate: string;
    let days: number;

    const msPerDay = 1000 * 60 * 60 * 24;
    const endUtc = this.parseUtcDate(endDate);

    if (options.days !== undefined) {
      const parsedDays = Number(options.days);
      if (!Number.isInteger(parsedDays) || parsedDays < 1 || parsedDays > 30) {
        throw new BadRequestException('days must be an integer between 1 and 30');
      }
      days = parsedDays;
    } else {
      days = 30;
    }

    if (options.startDate) {
      this.validateDate(options.startDate, 'startDate');
      const startUtc = this.parseUtcDate(options.startDate);
      const diffDays = Math.round((endUtc.getTime() - startUtc.getTime()) / msPerDay);

      if (diffDays < 0) {
        throw new BadRequestException('startDate cannot be after endDate');
      }

      if (diffDays > 30) {
        throw new BadRequestException('Date interval (endDate - startDate) cannot exceed 30 days');
      }

      startDate = options.startDate;
      days = diffDays + 1;
    } else {
      const startUtc = new Date(endUtc.getTime() - (days - 1) * msPerDay);
      startDate = this.formatUtcDate(startUtc);
      this.validateDate(startDate, 'startDate');
    }

    const cacheKey = `fuel-history-${startDate}-${endDate}`;
    try {
      const cached = await this.redisReader.read(cacheKey);
      if (cached) {
        return cached;
      }
    } catch (err) {
      this.logger.warn(`Failed to read cache for ${cacheKey}: ${err.message}`);
    }

    const months = this.getMonthsInRange(startDate, endDate);
    const monthEntriesArrays = await Promise.all(
      months.map(m =>
        this.fetchMonthEntries(m.year, m.month).catch(err => {
          if (err instanceof NotFoundException) {
            return [] as DailyFuelEntry[];
          }
          throw err;
        })
      )
    );

    const allMonthEntries: DailyFuelEntry[] = monthEntriesArrays.flat();
    allMonthEntries.sort((a, b) => a.date.localeCompare(b.date));

    const dateMap = new Map<string, FuelPrices>();
    for (const entry of allMonthEntries) {
      if (entry.date >= startDate && entry.date <= endDate) {
        dateMap.set(entry.date, entry.prices);
      }
    }

    const sortedDates = Array.from(dateMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));

    const items: FuelHistoryItem[] = await Promise.all(
      sortedDates.map(async ([date, prices]) => {
        const earlier = allMonthEntries.filter(e => e.date < date);
        const prevEntry =
          earlier.length > 0
            ? earlier[earlier.length - 1]
            : await this.getPreviousDailyEntry(date, allMonthEntries);

        const delta = this.calculateDelta(prices, prevEntry?.prices);
        return {
          date,
          prices,
          delta,
        };
      })
    );

    const response: FuelHistoryResponse = {
      startDate,
      endDate,
      days,
      currency: 'UAH',
      unit: 'грн/л',
      items,
      source: this.baseUrl,
    };

    const hasTodayEntry = items.some(item => item.date === today);
    if (endDate !== today || hasTodayEntry) {
      await this.safeCacheWrite(cacheKey, response);
    }

    return response;
  }

  private calculateDelta(current: FuelPrices, prev?: FuelPrices): FuelPrices | undefined {
    if (!prev) return undefined;
    const delta: FuelPrices = {};
    let hasAny = false;

    const keys: Array<keyof FuelPrices> = [
      'a95Premium',
      'a95',
      'a92',
      'diesel',
      'dieselPremium',
      'gas',
    ];

    for (const key of keys) {
      const currVal = current[key];
      const prevVal = prev[key];
      if (typeof currVal === 'number' && typeof prevVal === 'number') {
        delta[key] = Math.round((currVal - prevVal) * 100) / 100;
        hasAny = true;
      }
    }

    return hasAny ? delta : undefined;
  }

  private async getPreviousDailyEntry(
    entryDate: string,
    entries: DailyFuelEntry[]
  ): Promise<DailyFuelEntry | undefined> {
    const earlierInEntries = entries
      .filter(e => e.date < entryDate)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (earlierInEntries.length > 0) {
      return earlierInEntries[earlierInEntries.length - 1];
    }

    const [year, month] = entryDate.split('-');
    const prevMonthStr = this.getPreviousMonth(year, month);
    if (prevMonthStr) {
      const [prevYear, prevM] = prevMonthStr.split('-');
      try {
        const prevMonthEntries = await this.fetchMonthEntries(prevYear, prevM);
        if (prevMonthEntries.length > 0) {
          prevMonthEntries.sort((a, b) => a.date.localeCompare(b.date));
          return prevMonthEntries[prevMonthEntries.length - 1];
        }
      } catch (err) {
        this.logger.warn(
          `Could not fetch previous month ${prevMonthStr} for delta: ${err.message}`
        );
      }
    }

    return undefined;
  }

  private async safeCacheWrite(key: string, value: any): Promise<void> {
    try {
      await this.redisReader.write(key, value);
    } catch (err) {
      this.logger.warn(`Failed to write cache for ${key}: ${err.message}`);
    }
  }

  private async fetchMonthEntries(year: string, month: string): Promise<DailyFuelEntry[]> {
    const url = `${this.baseUrl}${year}-${month}/`;

    const html = await this.fetchHtml(url);
    return this.parseZebraTable(html);
  }

  private async fetchHtml(url: string): Promise<string> {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    if (response.status === 404) {
      throw new NotFoundException(`Page not found: ${url}`);
    }

    if (!response.ok) {
      this.logger.error(`Failed to fetch ${url}: HTTP ${response.status} ${response.statusText}`);
      throw new Error(`Failed to fetch data from Minfin: HTTP ${response.status}`);
    }

    return await response.text();
  }

  private parseZebraTable(html: string): DailyFuelEntry[] {
    const $ = cheerio.load(html);
    const table = $('table.zebra');

    if (!table.length) {
      return [];
    }

    // Map column index to fuel type from table headers
    const headerMap: { [colIndex: number]: keyof FuelPrices } = {};
    table
      .find('tr')
      .first()
      .find('th')
      .each((index, el) => {
        const text = $(el).text().trim().toLowerCase().replace(/\s+/g, ' ');
        if (text.includes('95+') || text.includes('95 +') || text.includes('преміум')) {
          headerMap[index] = 'a95Premium';
        } else if (text.includes('95')) {
          headerMap[index] = 'a95';
        } else if (text.includes('92')) {
          headerMap[index] = 'a92';
        } else if (text.includes('дп+') || text.includes('дизель+') || text.includes('дп +')) {
          headerMap[index] = 'dieselPremium';
        } else if (text.includes('дп') || text.includes('дизель')) {
          headerMap[index] = 'diesel';
        } else if (text.includes('газ')) {
          headerMap[index] = 'gas';
        }
      });

    const entries: DailyFuelEntry[] = [];

    // Parse each table data row
    table.find('tr').each((rowIndex, rowEl) => {
      const tds = $(rowEl).find('td');
      if (!tds.length) return;

      const dateText = $(tds[0]).text().trim();
      const match = dateText.match(/(\d{2})\.(\d{2})\.(\d{4})/);
      if (!match) return;

      const [, day, month, year] = match;
      const rowDate = `${year}-${month}-${day}`;

      const prices: FuelPrices = {};

      tds.each((colIndex, tdEl) => {
        const fuelKey = headerMap[colIndex];
        if (!fuelKey) return;

        const rawPrice = $(tdEl).text().trim().replace(',', '.');
        const price = parseFloat(rawPrice);
        if (!isNaN(price) && price > 0) {
          prices[fuelKey] = price;
        }
      });

      entries.push({ date: rowDate, prices });
    });

    return entries;
  }

  private validateDate(dateStr: string, fieldName = 'date'): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      throw new BadRequestException(`${fieldName} must be in YYYY-MM-DD format (e.g. 2026-09-13)`);
    }

    this.parseUtcDate(dateStr);

    const minDate = '2015-06-01';
    if (dateStr < minDate) {
      throw new BadRequestException(
        `Fuel price archive is available starting from June 2015 (${minDate})`
      );
    }

    const today = this.getTodayDateKyiv();
    if (dateStr > today) {
      throw new BadRequestException(`Date cannot be in the future. Today is ${today}`);
    }
  }

  private parseUtcDate(dateStr: string): Date {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      throw new BadRequestException(`Invalid date: ${dateStr}`);
    }
    return date;
  }

  private formatUtcDate(date: Date): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private getMonthsInRange(
    startDate: string,
    endDate: string
  ): Array<{ year: string; month: string }> {
    const months: Array<{ year: string; month: string }> = [];
    const [startYear, startMonth] = startDate.split('-').map(Number);
    const [endYear, endMonth] = endDate.split('-').map(Number);

    let curYear = startYear;
    let curMonth = startMonth;

    while (curYear < endYear || (curYear === endYear && curMonth <= endMonth)) {
      months.push({
        year: curYear.toString(),
        month: curMonth.toString().padStart(2, '0'),
      });
      curMonth++;
      if (curMonth > 12) {
        curMonth = 1;
        curYear++;
      }
    }

    return months;
  }

  private getTodayDateKyiv(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Kyiv',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  private getPreviousMonth(yearStr: string, monthStr: string): string | null {
    let year = parseInt(yearStr, 10);
    let month = parseInt(monthStr, 10);

    if (isNaN(year) || isNaN(month)) return null;

    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }

    if (year < 2015 || (year === 2015 && month < 6)) {
      return null;
    }

    const paddedMonth = month.toString().padStart(2, '0');
    return `${year}-${paddedMonth}`;
  }
}
