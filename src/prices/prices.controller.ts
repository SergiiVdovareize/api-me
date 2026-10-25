import { Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PricesService } from './prices.service';
import { CheckPricesSummary } from './dto/check-prices.dto';

@Controller('prices')
export class PricesController {
  constructor(
    private readonly pricesService: PricesService,
    private readonly configService: ConfigService
  ) {}

  @Post('check')
  async checkPrices(
    @Headers('x-cron-secret') cronSecretHeader?: string,
    @Headers('x-check-secret') checkSecretHeader?: string,
    @Headers('authorization') authHeader?: string
  ): Promise<CheckPricesSummary> {
    const providedSecret =
      cronSecretHeader ||
      checkSecretHeader ||
      (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader);

    const expectedSecret =
      this.configService.get<string>('PRICES_CHECK_SECRET') ||
      this.configService.get<string>('CRON_SECRET');

    if (!providedSecret || !expectedSecret) {
      throw new UnauthorizedException('Unauthorized: Missing or invalid secret header');
    }

    if (!this.timingSafeCompare(providedSecret, expectedSecret)) {
      throw new UnauthorizedException('Unauthorized: Invalid secret header');
    }

    return this.pricesService.checkDuePrices();
  }

  /**
   * Constant-time string comparison to prevent timing attacks.
   */
  private timingSafeCompare(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);

    if (bufA.length !== bufB.length) {
      return false;
    }

    return crypto.timingSafeEqual(bufA, bufB);
  }
}
