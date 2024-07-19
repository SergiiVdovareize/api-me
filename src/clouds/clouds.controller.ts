import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { CloudsService } from './clouds.service';
import { RequestsService } from 'src/requests/requests.service';

@Controller('clouds')
export class CloudsController {
  constructor(
    private readonly cloudsService: CloudsService,
    private readonly requestService: RequestsService,
  ) {}

  @Get('/fibonacci/:index')
  async fibonacci(@Param('index', ParseIntPipe) index: number) {
    await this.requestService.registerFibonacciApiCall();
    return this.cloudsService.getFibonacciNumber(index);
  }

  @Get('/prime/:index')
  async prime(@Param('index', ParseIntPipe) index: number) {
    await this.requestService.registerPrimeApiCall();
    return this.cloudsService.getPrimeNumber(index);
  }

  @Get('/armstrong/:index')
  async armstrong(@Param('index', ParseIntPipe) index: number) {
    await this.requestService.registerArmstrongApiCall();
    return this.cloudsService.getArmstrongNumber(index);
  }
}
