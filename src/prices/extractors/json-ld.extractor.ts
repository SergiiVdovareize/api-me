import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { ExtractedProductData, PriceExtractor } from './extractor.interface';
import { normalizePrice } from '../price-normalizer';

@Injectable()
export class JsonLdExtractor implements PriceExtractor {
  readonly strategy = 'JSON_LD' as const;
  private readonly logger = new Logger(JsonLdExtractor.name);

  async extract(html: string): Promise<ExtractedProductData | null> {
    try {
      const $ = cheerio.load(html);
      const scripts = $('script[type="application/ld+json"]').toArray();

      for (const el of scripts) {
        const text = $(el).text().trim();
        if (!text) continue;

        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          continue;
        }

        const product = this.findProductObject(parsed);
        if (!product) continue;

        const result = this.extractFromProductObject(product);
        if (result) return result;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.debug(`JSON-LD extraction failed: ${msg}`);
    }

    return null;
  }

  private findProductObject(data: unknown): Record<string, unknown> | null {
    if (!data) return null;

    if (Array.isArray(data)) {
      for (const item of data) {
        const found = this.findProductObject(item);
        if (found) return found;
      }
      return null;
    }

    if (typeof data === 'object') {
      const record = data as Record<string, unknown>;
      const type = record['@type'];
      if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) {
        return record;
      }

      if (record['@graph'] && Array.isArray(record['@graph'])) {
        return this.findProductObject(record['@graph']);
      }
    }

    return null;
  }

  private extractFromProductObject(product: Record<string, unknown>): ExtractedProductData | null {
    const title =
      typeof product.name === 'string'
        ? product.name.trim()
        : typeof product.title === 'string'
          ? product.title.trim()
          : undefined;

    const offers = product.offers;
    if (!offers) return null;

    const offerList = Array.isArray(offers) ? offers : [offers];

    for (const offer of offerList) {
      if (!offer || typeof offer !== 'object') continue;

      const offerRecord = offer as Record<string, unknown>;
      const rawPrice =
        (offerRecord.price as string | number | undefined) ??
        (offerRecord.lowPrice as string | number | undefined) ??
        (offerRecord.highPrice as string | number | undefined);
      const rawCurrency = (offerRecord.priceCurrency as string | undefined) || 'UAH';
      const normalized = normalizePrice(rawPrice, rawCurrency);

      if (normalized) {
        const availability = (offerRecord.availability || '').toString().toLowerCase();
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

    return null;
  }
}
