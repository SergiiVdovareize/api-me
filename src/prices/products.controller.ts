import { Body, Controller, Headers, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PricesService } from './prices.service';
import { CreateProductDto, CreateProductResponse } from './dto/create-product.dto';
import { validateCronSecret } from './prices.auth';

@Controller('products')
export class ProductsController {
  constructor(
    private readonly pricesService: PricesService,
    private readonly configService: ConfigService
  ) {}

  @Post()
  async createProduct(
    @Body() dto: CreateProductDto,
    @Headers('x-cron-secret') cronSecretHeader?: string,
    @Headers('x-check-secret') checkSecretHeader?: string,
    @Headers('authorization') authHeader?: string
  ): Promise<CreateProductResponse> {
    validateCronSecret(this.configService, cronSecretHeader, checkSecretHeader, authHeader);
    return this.pricesService.createProduct(dto);
  }
}
