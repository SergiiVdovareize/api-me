import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { ExtractedProductData, PriceExtractor } from './extractor.interface';
import { LlmService } from '../../llm/llm.service';
import { normalizePrice } from '../price-normalizer';

interface AiExtractionResponse {
  title?: string;
  price?: number;
  currency?: string;
  inStock?: boolean;
  selector?: string;
}

@Injectable()
export class AiExtractor implements PriceExtractor {
  readonly strategy = 'AI' as const;
  private readonly logger = new Logger(AiExtractor.name);

  constructor(private readonly llmService: LlmService) {}

  async extract(html: string): Promise<ExtractedProductData | null> {
    try {
      const $ = cheerio.load(html);

      // Clean HTML from heavy and irrelevant elements
      $('script, style, noscript, svg, img, video, iframe, nav, footer, header').remove();

      // Extract candidate body or main content
      const content = ($('main').length ? $('main') : $('body')).html() || html;

      // Clean up excess whitespace and limit payload size
      const cleanedHtml = content
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\s+/g, ' ')
        .slice(0, 25000);

      const systemPrompt = `You are an expert e-commerce HTML price parser.
Analyze the provided HTML snippet of a product page and extract the current active product details.
CRITICAL:
1. Extract the active/discounted price, NOT crossed-out/original/old prices.
2. Return a valid CSS selector for the element that directly contains this price text.
3. Output MUST be strict valid JSON matching:
{
  "title": "string or null",
  "price": 1299.00,
  "currency": "UAH",
  "inStock": true,
  "selector": ".product-price__current"
}`;

      const userPrompt = `HTML snippet:
${cleanedHtml}

Return the extracted JSON.`;

      const aiResponse = await this.llmService.callAndParseJSON<AiExtractionResponse>(
        systemPrompt,
        userPrompt
      );

      if (!aiResponse || !aiResponse.price || aiResponse.price <= 0) {
        return null;
      }

      const normalized = normalizePrice(aiResponse.price, aiResponse.currency || 'UAH');
      if (!normalized) {
        return null;
      }

      let validatedSelector: string | undefined;

      // Validate that the selector actually extracts the price in Cheerio
      if (aiResponse.selector) {
        try {
          const matchedEl = $(aiResponse.selector);
          if (matchedEl.length > 0) {
            const elText = matchedEl.first().text().trim();
            const elNormalized = normalizePrice(elText);
            if (elNormalized && Math.abs(elNormalized.price - normalized.price) < 0.01) {
              validatedSelector = aiResponse.selector;
            } else {
              this.logger.warn(
                `AI selector "${aiResponse.selector}" extracted "${elText}" (parsed as ${elNormalized?.price}), which didn't match AI price ${normalized.price}`
              );
            }
          }
        } catch (selectorErr: any) {
          this.logger.warn(
            `Invalid CSS selector returned by AI: "${aiResponse.selector}": ${selectorErr.message}`
          );
        }
      }

      return {
        title: aiResponse.title?.trim() || undefined,
        price: normalized.price,
        currency: normalized.currency,
        inStock: aiResponse.inStock ?? true,
        selector: validatedSelector,
        strategy: this.strategy,
      };
    } catch (err: any) {
      this.logger.error(`AI extractor failed: ${err.message}`, err.stack);
      return null;
    }
  }
}
