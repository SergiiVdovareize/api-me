import { Controller, Get, Query } from '@nestjs/common';
import { FuelService } from './fuel.service';
import { FuelHistoryResponse, FuelPricesResponse } from './interfaces/fuel-prices.interface';

@Controller('fuel')
export class FuelController {
  constructor(private readonly fuelService: FuelService) {}

  @Get()
  async getPrices(@Query('date') date?: string): Promise<FuelPricesResponse> {
    return this.fuelService.getPrices(date);
  }

  @Get('history')
  async getHistory(
    @Query('endDate') endDate?: string,
    @Query('days') days?: string,
    @Query('startDate') startDate?: string
  ): Promise<FuelHistoryResponse> {
    return this.fuelService.getHistory({ endDate, days, startDate });
  }

  @Get('prices')
  async getPricesAlias(@Query('date') date?: string): Promise<FuelPricesResponse> {
    return this.fuelService.getPrices(date);
  }
}
