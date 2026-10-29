import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../models/prisma/prisma.service';
import { RedisReader } from '../common/helpers/redisReader';
import { SafeFetchService } from './fetcher/safe-fetch.service';
import { JsonLdExtractor } from './extractors/json-ld.extractor';
import { MetaExtractor } from './extractors/meta.extractor';
import { RecipeExtractor } from './extractors/recipe.extractor';
import { AiExtractor } from './extractors/ai.extractor';
import { ExtractedProductData } from './extractors/extractor.interface';
import { NotificationService } from './notification.service';
import { normalizeProductUrl } from './url-normalizer';
import { CreateProductDto, CreateProductResponse } from './dto/create-product.dto';
import { CheckPricesSummary } from './dto/check-prices.dto';
import { PriceProduct, PriceProductStatus, Prisma } from '@prisma/client';

import { extractClothingVariants } from './extractors/clothing-variant.helper';

export interface PriceHistoryItem {
  price: number;
  inStock: boolean;
  checkedAt: string;
}

export const PRICES_CONFIG = {
  BATCH_LIMIT: 8,
  CONCURRENCY_LIMIT: 3,
  DEFAULT_CHECK_INTERVAL_HOURS: 2,
  LONG_STABLE_CHECK_INTERVAL_HOURS: 12,
  MAX_PRICE_SPIKE_PERCENT: 40,
  MAX_FAILURES_BEFORE_ERROR: 3,
  MAX_FAILURES_BEFORE_UNSUPPORTED: 6,
  MAX_HISTORY_ITEMS: 100,
};

export type PriceCheckFailureType =
  | 'WAF_BLOCKED'
  | 'NOT_FOUND'
  | 'NETWORK_ERROR'
  | 'EXTRACTION_FAILED';

export interface CheckProductResult {
  status: 'CHANGED' | 'UNCHANGED' | 'FAILED' | 'SKIPPED';
  reason?: string;
  failureType?: PriceCheckFailureType;
}

@Injectable()
export class PricesService {
  private readonly logger = new Logger(PricesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisReader: RedisReader,
    private readonly safeFetch: SafeFetchService,
    private readonly jsonLdExtractor: JsonLdExtractor,
    private readonly metaExtractor: MetaExtractor,
    private readonly recipeExtractor: RecipeExtractor,
    private readonly aiExtractor: AiExtractor,
    private readonly notificationService: NotificationService
  ) {}

  /**
   * Adds a product to tracking and performs an initial trial extraction.
   * If product already exists, updates subscription alert parameters.
   */
  async createProduct(dto: CreateProductDto): Promise<CreateProductResponse> {
    if (!dto.url) {
      throw new BadRequestException('URL is required');
    }

    const { normalizedUrl, domain } = normalizeProductUrl(dto.url);

    // 1. Deduplication: check if already tracked
    const existing = await this.prisma.priceProduct.findUnique({
      where: { url: normalizedUrl },
    });

    if (existing) {
      this.logger.log(`Product already exists: ${normalizedUrl}. Updating subscription settings.`);
      const updated = await this.prisma.priceProduct.update({
        where: { id: existing.id },
        data: {
          targetPrice: dto.targetPrice !== undefined ? dto.targetPrice : existing.targetPrice,
          dropPercent: dto.dropPercent !== undefined ? dto.dropPercent : existing.dropPercent,
          notifyOnRestock:
            dto.notifyOnRestock !== undefined ? dto.notifyOnRestock : existing.notifyOnRestock,
          desiredSize: dto.desiredSize !== undefined ? dto.desiredSize : existing.desiredSize,
          desiredColor: dto.desiredColor !== undefined ? dto.desiredColor : existing.desiredColor,
          chatId: dto.chatId || existing.chatId || '1252877',
          status: PriceProductStatus.ACTIVE,
          failCount: 0,
        },
      });

      return {
        id: updated.id,
        url: updated.url,
        title: updated.title,
        price: updated.lastPrice ?? 0,
        currency: updated.currency,
        inStock: updated.inStock,
        status: updated.status,
        sizes: Array.isArray(updated.sizes) ? (updated.sizes as string[]) : undefined,
        colors: Array.isArray(updated.colors) ? (updated.colors as string[]) : undefined,
      };
    }

    // 2. Initial extraction
    let extracted: ExtractedProductData | null = null;
    try {
      extracted = await this.extractProductData(normalizedUrl, domain);
    } catch (err: any) {
      this.logger.warn(`Failed initial fetch for ${normalizedUrl}: ${err.message}`);
      throw new BadRequestException(
        `Failed to fetch product from ${domain}: ${err.message}`
      );
    }

    if (!extracted || !extracted.price) {
      throw new BadRequestException('PRICE_NOT_FOUND');
    }

    const now = new Date();
    const nextCheckAt = new Date(
      now.getTime() + PRICES_CONFIG.DEFAULT_CHECK_INTERVAL_HOURS * 60 * 60 * 1000
    );

    const historyItem = {
      price: extracted.price,
      inStock: extracted.inStock,
      checkedAt: now.toISOString(),
    };

    const initialColors =
      extracted.colors ?? (extracted.currentColor ? [extracted.currentColor] : undefined);

    const created = await this.prisma.priceProduct.create({
      data: {
        url: normalizedUrl,
        domain,
        title: extracted.title || domain,
        lastPrice: extracted.price,
        currency: extracted.currency,
        inStock: extracted.inStock,
        status: PriceProductStatus.ACTIVE,
        targetPrice: dto.targetPrice ?? null,
        dropPercent: dto.dropPercent ?? null,
        notifyOnRestock: dto.notifyOnRestock ?? false,
        desiredSize: dto.desiredSize ?? null,
        desiredColor: dto.desiredColor ?? null,
        sizes: extracted.sizes
          ? (extracted.sizes as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        colors: initialColors
          ? (initialColors as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        chatId: dto.chatId || '1252877',
        selector: extracted.selector ?? null,
        failCount: 0,
        history: [historyItem],
        lastCheckedAt: now,
        nextCheckAt,
      },
    });

    return {
      id: created.id,
      url: created.url,
      title: created.title,
      price: created.lastPrice ?? 0,
      currency: created.currency,
      inStock: created.inStock,
      status: created.status,
      sizes: extracted.sizes,
      colors: extracted.colors,
      currentColor: extracted.currentColor,
    };
  }

  /**
   * Orchestrates batch price checks for products whose nextCheckAt <= now.
   */
  async checkDuePrices(): Promise<CheckPricesSummary> {
    const now = new Date();

    const products = await this.prisma.priceProduct.findMany({
      where: {
        status: { in: [PriceProductStatus.ACTIVE, PriceProductStatus.ERROR] },
        nextCheckAt: { lte: now },
      },
      orderBy: { nextCheckAt: 'asc' },
      take: PRICES_CONFIG.BATCH_LIMIT,
    });

    let checked = 0;
    let changed = 0;
    let failed = 0;
    const failedProducts: Array<{
      id: number;
      domain: string;
      url: string;
      failCount: number;
      reason?: string;
    }> = [];


    for (let i = 0; i < products.length; i += PRICES_CONFIG.CONCURRENCY_LIMIT) {
      const chunk = products.slice(i, i + PRICES_CONFIG.CONCURRENCY_LIMIT);
      const settled = await Promise.allSettled(
        chunk.map(product => this.processProductWithLock(product))
      );

      for (let j = 0; j < chunk.length; j++) {
        const product = chunk[j];
        const res = settled[j];

        if (res.status === 'fulfilled') {
          const outcome: CheckProductResult =
            typeof res.value === 'string'
              ? { status: res.value as CheckProductResult['status'] }
              : res.value;

          if (outcome.status === 'CHANGED') {
            checked++;
            changed++;
          } else if (outcome.status === 'UNCHANGED') {
            checked++;
          } else if (outcome.status === 'FAILED') {
            failed++;
            failedProducts.push({
              id: product.id,
              domain: product.domain,
              url: product.url,
              failCount: product.failCount + 1,
              reason: outcome.reason,
            });
          }
        } else {
          failed++;
          failedProducts.push({
            id: product.id,
            domain: product.domain,
            url: product.url,
            failCount: product.failCount + 1,
            reason: (res as PromiseRejectedResult).reason?.message,
          });
        }
      }
    }

    if (failed > 0) {
      const msg = `[PriceTracker Batch] ${failed} product price check(s) failed out of ${products.length} due products`;
      this.logger.warn(msg);
      Sentry.captureMessage(msg, {
        level: 'warning',
        tags: {
          component: 'price-tracker',
          operation: 'checkDuePrices',
        },
        fingerprint: ['price-tracker-batch-failures'],
        extra: {
          checked,
          changed,
          failed,
          total: products.length,
          failedProductIds: failedProducts.map(p => p.id),
          failedProducts,
        },
      });
    }

    return { checked, changed, failed };
  }

  /**
   * Processes a single product with distributed Redis lock.
   */
  private async processProductWithLock(
    product: PriceProduct
  ): Promise<CheckProductResult> {
    const lockKey = `lock:price-product:${product.id}`;
    let acquiredLock = false;

    try {
      if (this.redisReader.redis) {
        const res = await this.redisReader.redis.set(lockKey, '1', {
          nx: true,
          ex: 120, // 2-minute lock
        });
        if (!res) {
          this.logger.debug(`Skipping product #${product.id}: lock already held`);
          return { status: 'SKIPPED' };
        }
        acquiredLock = true;
      }

      return await this.checkSingleProduct(product);
    } catch (err: any) {
      this.logger.error(
        `Unexpected error checking product #${product.id}: ${err.message}`,
        err.stack
      );
      return {
        status: 'FAILED',
        reason: err.message,
        failureType: 'NETWORK_ERROR',
      };
    } finally {
      if (acquiredLock && this.redisReader.redis) {
        await this.redisReader.redis.del(lockKey).catch(() => {});
      }
    }
  }

  /**
   * Checks an individual product and updates state, history, and notifications.
   */
  private async checkSingleProduct(
    product: PriceProduct
  ): Promise<CheckProductResult> {
    let extracted: ExtractedProductData | null = null;
    let failureType: PriceCheckFailureType = 'EXTRACTION_FAILED';
    let failureReason = 'Price not found in page content';

    try {
      extracted = await this.extractProductData(
        product.url,
        product.domain,
        product.selector,
        product.failCount >= 2 // only trigger AI on self-healing retry
      );
    } catch (err: any) {
      const msg = String(err?.message || '');
      this.logger.warn(`Fetch error for product #${product.id}: ${msg}`);
      if (
        msg.includes('403') ||
        msg.toLowerCase().includes('forbidden') ||
        msg.toLowerCase().includes('challenge')
      ) {
        failureType = 'WAF_BLOCKED';
        failureReason = 'Blocked by WAF/Cloudflare (HTTP 403)';
      } else if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
        failureType = 'NOT_FOUND';
        failureReason = 'Product page not found (HTTP 404)';
      } else if (
        msg.includes('timed out') ||
        msg.includes('AbortError') ||
        msg.includes('502') ||
        msg.includes('503') ||
        msg.includes('504') ||
        msg.includes('fetch failed')
      ) {
        failureType = 'NETWORK_ERROR';
        failureReason = `Network/server error (${msg})`;
      } else {
        failureType = 'NETWORK_ERROR';
        failureReason = `Fetch failed: ${msg}`;
      }
    }

    const now = new Date();

    // 1. Handle parsing failure
    if (!extracted || !extracted.price || extracted.price <= 0) {
      const newFailCount = product.failCount + 1;
      const backoffHours = Math.min(24, Math.pow(2, newFailCount));
      const nextCheckAt = new Date(now.getTime() + backoffHours * 60 * 60 * 1000);

      let newStatus: PriceProductStatus = product.status;
      if (newFailCount >= PRICES_CONFIG.MAX_FAILURES_BEFORE_UNSUPPORTED) {
        newStatus = PriceProductStatus.UNSUPPORTED;
        await this.notificationService.notifyAdminError(
          product,
          `Marked UNSUPPORTED after ${newFailCount} consecutive failures: ${failureReason}`,
          { failureType, failureReason }
        );
      } else if (newFailCount >= PRICES_CONFIG.MAX_FAILURES_BEFORE_ERROR) {
        newStatus = PriceProductStatus.ERROR;
        if (newFailCount === PRICES_CONFIG.MAX_FAILURES_BEFORE_ERROR) {
          await this.notificationService.notifyAdminError(
            product,
            `${failureReason} (${newFailCount} times in a row)`,
            { failureType, failureReason }
          );
        }
      }

      await this.prisma.priceProduct.update({
        where: { id: product.id },
        data: {
          failCount: newFailCount,
          status: newStatus,
          nextCheckAt,
          lastCheckedAt: now,
        },
      });

      return { status: 'FAILED', reason: failureReason, failureType };
    }

    // 2. Price spike validation (> 40% change without intermediate check)
    if (product.lastPrice && product.lastPrice > 0) {
      const diffPercent = (Math.abs(extracted.price - product.lastPrice) / product.lastPrice) * 100;
      if (diffPercent > PRICES_CONFIG.MAX_PRICE_SPIKE_PERCENT && product.failCount === 0) {
        this.logger.warn(
          `Price spike of ${Math.round(diffPercent)}% detected for product #${product.id} (${product.lastPrice} -> ${extracted.price}). Rescheduling re-check in 10 minutes.`
        );
        // Do not write immediately; reschedule fast re-check to confirm
        await this.prisma.priceProduct.update({
          where: { id: product.id },
          data: {
            failCount: 1, // mark for re-check
            nextCheckAt: new Date(now.getTime() + 10 * 60 * 1000),
            lastCheckedAt: now,
          },
        });
        return { status: 'UNCHANGED' };
      }
    }

    // 3. Compare with last price, in-stock status, and sizes/colors
    const isPriceChanged = product.lastPrice !== extracted.price;
    const isStockChanged = product.inStock !== extracted.inStock;

    const prevSizes = Array.isArray(product.sizes) ? (product.sizes as string[]) : [];
    const prevColors = Array.isArray(product.colors) ? (product.colors as string[]) : [];
    const currentSizes = extracted.sizes || [];
    const currentColors = extracted.colors || [];

    const isSizeChanged = currentSizes.some(s => !prevSizes.includes(s));
    const isColorChanged = currentColors.some(c => !prevColors.includes(c));
    const hasChanged = isPriceChanged || isStockChanged || isSizeChanged || isColorChanged;

    let updatedHistory: PriceHistoryItem[] = Array.isArray(product.history)
      ? (product.history as unknown as PriceHistoryItem[])
      : [];
    let lastNotifiedPrice = product.lastNotifiedPrice;

    // Check alert conditions (price drop, restock, new size, new color)
    const condition = this.notificationService.checkConditions(
      product,
      extracted.price,
      extracted.inStock,
      extracted.sizes,
      extracted.colors,
      extracted.currentColor
    );

    if (condition.shouldNotify && condition.reason) {
      await this.notificationService.sendPriceAlert(
        product,
        extracted.price,
        extracted.inStock,
        condition.reason,
        {
          sizes: extracted.sizes,
          colors: extracted.colors,
          currentColor: extracted.currentColor,
          newSizes: condition.newSizes,
          newColors: condition.newColors,
        }
      );
      if (condition.reason === 'TARGET_PRICE' || condition.reason === 'DROP_PERCENT') {
        lastNotifiedPrice = extracted.price;
      }
    }

    if (isPriceChanged || isStockChanged) {
      // Append to history
      updatedHistory = [
        ...updatedHistory,
        {
          price: extracted.price,
          inStock: extracted.inStock,
          checkedAt: now.toISOString(),
        },
      ];

      if (updatedHistory.length > PRICES_CONFIG.MAX_HISTORY_ITEMS) {
        updatedHistory = updatedHistory.slice(-PRICES_CONFIG.MAX_HISTORY_ITEMS);
      }
    }

    // 4. Adaptive check frequency
    // If price remained unchanged for a week, gradually increase interval up to 12-24 hours
    let intervalHours = PRICES_CONFIG.DEFAULT_CHECK_INTERVAL_HOURS;
    if (!hasChanged && updatedHistory.length > 0) {
      const lastItem = updatedHistory[updatedHistory.length - 1];
      if (lastItem && lastItem.checkedAt) {
        const lastChange = new Date(lastItem.checkedAt).getTime();
        const daysSinceChange = (now.getTime() - lastChange) / (1000 * 60 * 60 * 24);
        if (daysSinceChange > 7) {
          intervalHours = PRICES_CONFIG.LONG_STABLE_CHECK_INTERVAL_HOURS;
        }
      }
    }

    const nextCheckAt = new Date(now.getTime() + intervalHours * 60 * 60 * 1000);

    const updatedColors =
      extracted.colors ??
      (extracted.currentColor ? [extracted.currentColor] : (product.colors as string[] | null));

    await this.prisma.priceProduct.update({
      where: { id: product.id },
      data: {
        lastPrice: extracted.price,
        currency: extracted.currency,
        inStock: extracted.inStock,
        sizes: extracted.sizes
          ? (extracted.sizes as unknown as Prisma.InputJsonValue)
          : ((product.sizes as Prisma.InputJsonValue) ?? Prisma.JsonNull),
        colors: updatedColors
          ? (updatedColors as unknown as Prisma.InputJsonValue)
          : ((product.colors as Prisma.InputJsonValue) ?? Prisma.JsonNull),
        selector: extracted.selector ?? product.selector,
        history: updatedHistory as unknown as Prisma.InputJsonValue,
        lastNotifiedPrice,
        failCount: 0,
        status: PriceProductStatus.ACTIVE,
        lastCheckedAt: now,
        nextCheckAt,
      },
    });

    return { status: hasChanged ? 'CHANGED' : 'UNCHANGED' };
  }

  /**
   * Runs the cascade of extractors on the product page.
   */
  private async extractProductData(
    url: string,
    domain: string,
    knownSelector?: string | null,
    allowAi = true
  ): Promise<ExtractedProductData | null> {
    let targetUrl = url;
    try {
      const normalized = normalizeProductUrl(url);
      targetUrl = normalized.normalizedUrl;
    } catch {
      // keep original url if normalization fails
    }

    const html = await this.safeFetch.fetchHtml(targetUrl, { maxRetries: 2 });

    let extracted: ExtractedProductData | null = null;

    // 1. JSON-LD
    extracted = await this.jsonLdExtractor.extract(html);

    // 2. Meta tags
    if (!extracted) {
      extracted = await this.metaExtractor.extract(html);
    }

    // 3. Domain recipe (from knownSelector or existing product from the same domain)
    if (!extracted) {
      let selectorToTry = knownSelector;
      if (!selectorToTry) {
        const siblingProduct = await this.prisma.priceProduct.findFirst({
          where: {
            domain,
            selector: { not: null },
            status: PriceProductStatus.ACTIVE,
          },
          orderBy: { updatedAt: 'desc' },
        });
        selectorToTry = siblingProduct?.selector;
      }

      if (selectorToTry) {
        extracted = await this.recipeExtractor.extract(html, { selector: selectorToTry });
      }
    }

    // 4. AI fallback
    if (!extracted && allowAi) {
      extracted = await this.aiExtractor.extract(html);
    }

    // 5. Enrich with clothing and footwear variants (sizes, colors) if present
    if (extracted) {
      const variants = extractClothingVariants(html);
      if (variants.sizes && variants.sizes.length > 0) {
        extracted.sizes = variants.sizes;
      }
      if (variants.colors && variants.colors.length > 0) {
        extracted.colors = variants.colors;
      }
      if (variants.currentColor) {
        extracted.currentColor = variants.currentColor;
      }
    }

    return extracted;
  }
}
