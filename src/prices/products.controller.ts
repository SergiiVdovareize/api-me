import { Body, Controller, Post } from '@nestjs/common';
import { PricesService } from './prices.service';
import { CreateProductDto, CreateProductResponse } from './dto/create-product.dto';

@Controller('products')
export class ProductsController {
  constructor(private readonly pricesService: PricesService) {}

  @Post()
  async createProduct(@Body() dto: CreateProductDto): Promise<CreateProductResponse> {
    return this.pricesService.createProduct(dto);
  }
}
