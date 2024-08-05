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

  @Get('/result/:id')
  async result(@Param('id') id: string) {
    const maxWaitTime = 60*60*1000; // 60 minutes
    const invalidIdResponse = {
        success: false,
        status: 1,
        message: 'result id is not valid'
    }
    const reg = /\w{2}(\d{1})\w{2}(\d{3})\w{2}(\d{3})\w{2}(\d{3})\w{2}(\d{3})\w{2}/;
    const groups = id.match(reg);

    if (!groups || groups.length !== 6) {
      return invalidIdResponse
    }

    const timestamp = parseInt(`${groups[3]}${groups[4]}${groups[5]}${groups[2]}${groups[1]}`, 10)
    if (isNaN(timestamp)) {
      return invalidIdResponse
    }

    const maxTimestamp = Date.now();
    if (timestamp < (maxTimestamp - maxWaitTime) || timestamp > maxTimestamp) {
      return invalidIdResponse
    }

    const resultFileUrl = await this.cloudsService.findResultFileUrlWithRetry(id)
    if (!resultFileUrl) {
      return {
        success: false,
        status: 2
      }
    }

    const result = await this.cloudsService.readResult(resultFileUrl)
    if (!result) {
      return {
        success: false,
        status: 3,
        message: 'could bot read result'
      }
    }

    return result;
  }
}
