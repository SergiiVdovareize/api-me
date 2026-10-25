import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { ExtractedProductData, ExtractOptions, PriceExtractor } from './extractor.interface';
import { normalizePrice } from '../price-normalizer';

@Injectable()
export class RecipeExtractor implements PriceExtractor {
  readonly strategy = 'RECIPE' as const;
  private readonly logger = new Logger(RecipeExtractor.name);

  async extract(html: string, options?: ExtractOptions): Promise<ExtractedProductData | null> {
    if (!options?.selector) {
      return null;
    }

    try {
      const $ = cheerio.load(html);
      const targetEl = $(options.selector);

      if (targetEl.length === 0) {
        return null;
      }

      const text = targetEl.first().text().trim();
      const normalized = normalizePrice(text);
      if (!normalized) {
        return null;
      }

      // Extract title
      const title =
        $('h1').first().text().trim() ||
        $('meta[property="og:title"]').attr('content') ||
        $('title').first().text().trim() ||
        undefined;

      // Basic stock detection
      const bodyLower = $('body').text().toLowerCase();
      const outOfStockKeywords = [
        'немає в наявності',
        'знято з виробництва',
        'out of stock',
        'sold out',
        'товар закінчився',
      ];

      let inStock = true;
      for (const phrase of outOfStockKeywords) {
        if (bodyLower.includes(phrase)) {
          // If the buy button is disabled or mentions out of stock
          const buyBtn = $('button:disabled, a.disabled, .out-of-stock, .unavailable');
          if (buyBtn.length > 0) {
            inStock = false;
            break;
          }
        }
      }

      return {
        title,
        price: normalized.price,
        currency: normalized.currency,
        inStock,
        selector: options.selector,
        strategy: this.strategy,
      };
    } catch (err: any) {
      this.logger.debug(`Recipe extraction failed: ${err.message}`);
    }

    return null;
  }
}
