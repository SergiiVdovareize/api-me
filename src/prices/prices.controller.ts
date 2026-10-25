import { Controller, Headers, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PricesService } from './prices.service';
import { CheckPricesSummary } from './dto/check-prices.dto';
import { validateCronSecret } from './prices.auth';

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
    validateCronSecret(this.configService, cronSecretHeader, checkSecretHeader, authHeader);
    return this.pricesService.checkDuePrices();
  }
}
