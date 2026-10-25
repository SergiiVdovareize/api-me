import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { ExtractedProductData, PriceExtractor } from './extractor.interface';
import { normalizePrice } from '../price-normalizer';

@Injectable()
export class MetaExtractor implements PriceExtractor {
  readonly strategy = 'META' as const;
  private readonly logger = new Logger(MetaExtractor.name);

  async extract(html: string): Promise<ExtractedProductData | null> {
    try {
      const $ = cheerio.load(html);

      // 1. Title
      const title =
        $('meta[property="og:title"]').attr('content') ||
        $('meta[name="twitter:title"]').attr('content') ||
        $('title').first().text().trim() ||
        undefined;

      // 2. Price amount candidates
      const priceCandidates = [
        $('meta[property="product:price:amount"]').attr('content'),
        $('meta[property="og:price:amount"]').attr('content'),
        $('meta[itemprop="price"]').attr('content'),
        $('meta[name="price"]').attr('content'),
        $('meta[name="twitter:data1"]').attr('content'),
      ];

      // 3. Currency candidates
      const currencyCandidates = [
        $('meta[property="product:price:currency"]').attr('content'),
        $('meta[property="og:price:currency"]').attr('content'),
        $('meta[itemprop="priceCurrency"]').attr('content'),
        $('meta[name="currency"]').attr('content'),
      ];

      const detectedCurrency = currencyCandidates.find(c => Boolean(c?.trim()))?.trim() || 'UAH';

      for (const candidate of priceCandidates) {
        if (!candidate) continue;

        const normalized = normalizePrice(candidate, detectedCurrency);
        if (normalized) {
          // Check stock
          const availability = (
            $('meta[property="product:availability"]').attr('content') ||
            $('meta[property="og:availability"]').attr('content') ||
            $('meta[itemprop="availability"]').attr('content') ||
            ''
          ).toLowerCase();

          const inStock =
            availability.includes('outofstock') || availability.includes('discontinued')
              ? false
              : true;

          return {
            title,
            price: normalized.price,
            currency: normalized.currency,
            inStock,
            strategy: this.strategy,
          };
        }
      }
    } catch (err: any) {
      this.logger.debug(`Meta extraction failed: ${err.message}`);
    }

    return null;
  }
}
