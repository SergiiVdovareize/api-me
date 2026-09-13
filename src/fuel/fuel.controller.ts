import { Controller, Get, Query } from '@nestjs/common';
import { FuelService } from './fuel.service';
import { FuelPricesResponse } from './interfaces/fuel-prices.interface';

@Controller('fuel')
export class FuelController {
  constructor(private readonly fuelService: FuelService) {}

  @Get()
  async getPrices(@Query('date') date?: string): Promise<FuelPricesResponse> {
    return this.fuelService.getPrices(date);
  }

  @Get('prices')
  async getPricesAlias(@Query('date') date?: string): Promise<FuelPricesResponse> {
    return this.fuelService.getPrices(date);
  }
}
