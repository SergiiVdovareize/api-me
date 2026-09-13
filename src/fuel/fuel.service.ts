import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { FuelPrices, FuelPricesResponse } from './interfaces/fuel-prices.interface';

interface DailyFuelEntry {
  date: string; // YYYY-MM-DD
  prices: FuelPrices;
}

@Injectable()
export class FuelService {
  private readonly logger = new Logger(FuelService.name);
  private readonly baseUrl = 'https://index.minfin.com.ua/ua/markets/fuel/';

  async getPrices(requestedDate?: string): Promise<FuelPricesResponse> {
    const targetDate = requestedDate || this.getTodayDateKyiv();

    this.validateDate(targetDate);

    const [year, month] = targetDate.split('-');
    const monthEntries = await this.fetchMonthEntries(year, month);

    // Exact match for the target date
    const exactMatch = monthEntries.find(entry => entry.date === targetDate);
    if (exactMatch) {
      return {
        requestedDate: targetDate,
        effectiveDate: exactMatch.date,
        isFallback: false,
        currency: 'UAH',
        unit: 'грн/л',
        prices: exactMatch.prices,
        source: `${this.baseUrl}${year}-${month}/`,
      };
    }

    // Look for previous available day in the same month
    const previousInMonth = monthEntries
      .filter(entry => entry.date <= targetDate)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (previousInMonth.length > 0) {
      const fallback = previousInMonth[previousInMonth.length - 1];
      return {
        requestedDate: targetDate,
        effectiveDate: fallback.date,
        isFallback: true,
        currency: 'UAH',
        unit: 'грн/л',
        prices: fallback.prices,
        source: `${this.baseUrl}${year}-${month}/`,
      };
    }

    // If target date is earlier than the first available date in this month (e.g. 1st or 2nd is weekend),
    // fetch the previous month's data and use the last available day
    const prevMonthStr = this.getPreviousMonth(year, month);
    if (prevMonthStr) {
      const [prevYear, prevM] = prevMonthStr.split('-');
      try {
        const prevMonthEntries = await this.fetchMonthEntries(prevYear, prevM);
        if (prevMonthEntries.length > 0) {
          const fallback = prevMonthEntries[prevMonthEntries.length - 1];
          return {
            requestedDate: targetDate,
            effectiveDate: fallback.date,
            isFallback: true,
            currency: 'UAH',
            unit: 'грн/л',
            prices: fallback.prices,
            source: `${this.baseUrl}${prevYear}-${prevM}/`,
          };
        }
      } catch (err) {
        this.logger.warn(`Could not fetch previous month ${prevMonthStr}: ${err.message}`);
      }
    }

    throw new NotFoundException(`Fuel price data not found for ${targetDate}`);
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

  private validateDate(dateStr: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      throw new BadRequestException('date must be in YYYY-MM-DD format (e.g. 2026-09-13)');
    }

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
