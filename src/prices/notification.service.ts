import { Injectable, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { OutboxQueueService } from '../outbox/outbox-queue.service';
import { PriceProduct } from '@prisma/client';

export type AlertReason = 'TARGET_PRICE' | 'DROP_PERCENT' | 'RESTOCK' | 'NEW_SIZE' | 'NEW_COLOR';

export interface NotificationCheckResult {
  shouldNotify: boolean;
  reason?: AlertReason;
  newSizes?: string[];
  newColors?: string[];
}

export interface VariantAlertData {
  sizes?: string[];
  colors?: string[];
  currentColor?: string;
  newSizes?: string[];
  newColors?: string[];
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly outboxQueueService: OutboxQueueService) {}

  /**
   * Checks whether subscription conditions are met for a price or variant update.
   */
  checkConditions(
    product: PriceProduct,
    newPrice: number,
    newInStock: boolean,
    currentSizes?: string[],
    currentColors?: string[],
    currentColor?: string
  ): NotificationCheckResult {
    const prevSizes = Array.isArray(product.sizes) ? (product.sizes as string[]) : [];
    const prevColors = Array.isArray(product.colors) ? (product.colors as string[]) : [];

    // 1. New Size condition
    if (currentSizes && currentSizes.length > 0) {
      if (product.desiredSize) {
        const desiredLower = product.desiredSize.trim().toLowerCase();
        const hasDesiredNow = currentSizes.some(s => s.trim().toLowerCase() === desiredLower);
        const hadDesiredBefore = prevSizes.some(s => s.trim().toLowerCase() === desiredLower);
        if (hasDesiredNow && !hadDesiredBefore) {
          return { shouldNotify: true, reason: 'NEW_SIZE', newSizes: [product.desiredSize] };
        }
      } else if (prevSizes.length > 0) {
        const newlyAdded = currentSizes.filter(s => !prevSizes.includes(s));
        if (newlyAdded.length > 0) {
          return { shouldNotify: true, reason: 'NEW_SIZE', newSizes: newlyAdded };
        }
      }
    }

    // 2. New Color condition
    const allAvailableColors = currentColors ?? (currentColor ? [currentColor] : []);
    if (allAvailableColors.length > 0) {
      if (product.desiredColor) {
        const desiredColorLower = product.desiredColor.trim().toLowerCase();
        const hasDesiredColorNow = allAvailableColors.some(
          c => c.trim().toLowerCase() === desiredColorLower
        );
        const hadDesiredColorBefore = prevColors.some(
          c => c.trim().toLowerCase() === desiredColorLower
        );
        if (hasDesiredColorNow && !hadDesiredColorBefore) {
          return { shouldNotify: true, reason: 'NEW_COLOR', newColors: [product.desiredColor] };
        }
      } else if (prevColors.length > 0) {
        const newlyAddedColors = allAvailableColors.filter(c => !prevColors.includes(c));
        if (newlyAddedColors.length > 0) {
          return { shouldNotify: true, reason: 'NEW_COLOR', newColors: newlyAddedColors };
        }
      }
    }

    // 3. Restock condition
    if (product.notifyOnRestock && newInStock && !product.inStock) {
      return { shouldNotify: true, reason: 'RESTOCK' };
    }

    // If out of stock, do not notify about price drops
    if (!newInStock) {
      return { shouldNotify: false };
    }

    // Do not notify about the same price again
    if (product.lastNotifiedPrice !== null && product.lastNotifiedPrice === newPrice) {
      return { shouldNotify: false };
    }

    // 4. Target price condition
    if (product.targetPrice !== null && newPrice <= product.targetPrice) {
      return { shouldNotify: true, reason: 'TARGET_PRICE' };
    }

    // 5. Drop percent condition
    const basePrice = product.lastNotifiedPrice ?? product.lastPrice;
    if (product.dropPercent !== null && basePrice && basePrice > newPrice) {
      const dropPct = ((basePrice - newPrice) / basePrice) * 100;
      if (dropPct >= product.dropPercent) {
        return { shouldNotify: true, reason: 'DROP_PERCENT' };
      }
    }

    // 6. Default: notify on any price drop if neither targetPrice nor dropPercent was specified
    if (
      product.targetPrice === null &&
      product.dropPercent === null &&
      basePrice &&
      newPrice < basePrice
    ) {
      return { shouldNotify: true, reason: 'DROP_PERCENT' };
    }

    return { shouldNotify: false };
  }

  /**
   * Formats and pushes a notification into the Telegram Outbox via GoogleSheetsService.
   */
  async sendPriceAlert(
    product: PriceProduct,
    newPrice: number,
    newInStock: boolean,
    reason: AlertReason,
    variants?: VariantAlertData
  ): Promise<void> {
    const chatId = product.chatId || '1252877';
    const escapedTitle = this.escapeHtml(product.title);
    const escapedUrl = this.escapeHtml(product.url);

    let header = '🔔 <b>Ціна змінилася!</b>';
    let details = '';

    const oldPrice = product.lastPrice;
    const diff = oldPrice ? oldPrice - newPrice : 0;
    const dropPct =
      oldPrice && oldPrice > 0 ? Math.round(((oldPrice - newPrice) / oldPrice) * 100) : 0;

    if (reason === 'NEW_SIZE') {
      const sizeStr = variants?.newSizes?.join(', ') || '';
      header = `🎉 <b>З'явився новий розмір: ${this.escapeHtml(sizeStr)}!</b>`;
      details = `💰 <b>Ціна:</b> ${newPrice} ${product.currency}`;
    } else if (reason === 'NEW_COLOR') {
      const colorStr = variants?.newColors?.join(', ') || '';
      header = `🎨 <b>З'явився новий колір: ${this.escapeHtml(colorStr)}!</b>`;
      details = `💰 <b>Ціна:</b> ${newPrice} ${product.currency}`;
    } else if (reason === 'RESTOCK') {
      header = '🎉 <b>Товар знову в наявності!</b>';
      details = `📦 <b>Ціна:</b> ${newPrice} ${product.currency}`;
    } else if (reason === 'TARGET_PRICE') {
      header = '🎯 <b>Досягнуто бажаної ціни!</b>';
      details = `💰 <b>Ціна:</b> ${newPrice} ${product.currency} (Ціль: ${product.targetPrice} ${product.currency})`;
      if (oldPrice && diff > 0) {
        details += `\n📉 Знижка: -${dropPct}% (було ${oldPrice} ${product.currency})`;
      }
    } else if (reason === 'DROP_PERCENT') {
      header = `📉 <b>Ціна впала на ${dropPct}%!</b>`;
      details = `💰 Стара ціна: <s>${oldPrice} ${product.currency}</s>\n✨ Нова ціна: <b>${newPrice} ${product.currency}</b> (-${Math.round(diff)} ${product.currency})`;
    }

    // Add apparel/footwear variant details if present
    const variantLines: string[] = [];
    const activeColor = variants?.currentColor || (variants?.colors && variants.colors[0]);
    if (activeColor) {
      let colorText = `🎨 <b>Колір:</b> ${this.escapeHtml(activeColor)}`;
      const otherColors = variants?.colors?.filter(c => c !== activeColor);
      if (otherColors && otherColors.length > 0) {
        colorText += ` (також є: ${this.escapeHtml(otherColors.join(', '))})`;
      }
      variantLines.push(colorText);
    }

    if (variants?.sizes && variants.sizes.length > 0) {
      variantLines.push(
        `📏 <b>Розміри в наявності:</b> ${this.escapeHtml(variants.sizes.join(', '))}`
      );
    }

    const variantsBlock = variantLines.length > 0 ? `\n\n${variantLines.join('\n')}` : '';

    const message = `${header}\n\n🏷 <b>${escapedTitle}</b>${variantsBlock}\n\n${details}\n\n🔗 <a href="${escapedUrl}">Перейти до магазину</a>`;

    try {
      await this.outboxQueueService.appendMessageToOutbox(message, chatId);
      this.logger.log(
        `Price alert queued for product "${product.title}" (${product.id}) [${reason}]`
      );
    } catch (err: any) {
      this.logger.error(
        `Failed to send price alert for product ${product.id}: ${err.message}`,
        err.stack
      );
      Sentry.captureException(err);
    }
  }

  /**
   * Reports critical parsing errors to Sentry and optionally admin chat.
   */
  async notifyAdminError(product: PriceProduct, errorReason: string): Promise<void> {
    const msg = `[PriceTracker Error] Product #${product.id} (${product.domain}): ${errorReason}`;
    this.logger.error(msg);
    Sentry.captureMessage(msg, {
      extra: {
        productId: product.id,
        url: product.url,
        failCount: product.failCount,
        status: product.status,
      },
    });
  }

  private escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
