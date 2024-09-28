import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { RequestsService } from './requests.service';

@Controller('requests')
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Get('/count')
  count() {
    return this.requestsService.countAll();
  }

  @Get('/count/month')
  countThisMonth() {
    return this.requestsService.countAllThisMonth();
  }

  @Get('/count/:apiType')
  countType(@Param('apiType', ParseIntPipe) apiType: number) {
    return this.requestsService.countType(apiType);
  }

  @Get('/count/month/:apiType')
  countTypeThisMonth(@Param('apiType', ParseIntPipe) apiType: number) {
    return this.requestsService.countTypeThisMonth(apiType);
  }
}
