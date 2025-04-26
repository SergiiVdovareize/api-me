import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { CloudsService } from './clouds.service';
import { RequestsService } from 'src/requests/requests.service';
import { AsyncService } from 'src/async/async.service';

const MONTH_LIMIT = {
  AMAZON: 900,
  GOOGLE: 900,
  AZURE: 900,
};

const LIMIT_MAP = {
  FIBONACCI: MONTH_LIMIT.AMAZON,
  PRIME: MONTH_LIMIT.GOOGLE,
  ARMSTRONG: MONTH_LIMIT.AZURE,
};

const limitedResponse = {
  success: false,
  message: 'no more free requests this month, try tomorrow',
};

@Controller('clouds')
export class CloudsController {
  constructor(
    private readonly cloudsService: CloudsService,
    private readonly requestsService: RequestsService,
    private readonly asyncService: AsyncService
  ) {}

  @Get('/fibonacci/:index')
  async fibonacci(@Param('index', ParseIntPipe) index: number) {
    const count = await this.requestsService.countFibonacciThisMonth();
    if (count >= LIMIT_MAP.ARMSTRONG) {
      return limitedResponse;
    }

    await this.requestsService.registerFibonacciApiCall();
    return this.cloudsService.getFibonacciNumber(index);
  }

  @Get('/prime/:index')
  async prime(@Param('index', ParseIntPipe) index: number) {
    const count = await this.requestsService.countPrimeThisMonth();
    if (count >= LIMIT_MAP.ARMSTRONG) {
      return limitedResponse;
    }

    await this.requestsService.registerPrimeApiCall();
    return this.cloudsService.getPrimeNumber(index);
  }

  @Get('/armstrong/:index')
  async armstrong(@Param('index', ParseIntPipe) index: number) {
    const count = await this.requestsService.countArmstrongThisMonth();
    if (count >= LIMIT_MAP.ARMSTRONG) {
      return limitedResponse;
    }

    await this.requestsService.registerArmstrongApiCall();
    return this.cloudsService.getArmstrongNumber(index);
  }

  // TODO: DEPRECATED, remove this method soon
  @Get('/result/:id')
  async result(@Param('id') id: string) {
    const maxWaitTime = 60 * 60 * 1000; // 60 minutes
    const invalidIdResponse = {
      success: false,
      status: 1,
      message: 'result id is not valid',
    };
    const reg = /\w{2}(\d{1})\w{2}(\d{3})\w{2}(\d{3})\w{2}(\d{3})\w{2}(\d{3})\w{2}/;
    const groups = id.match(reg);

    if (!groups || groups.length !== 6) {
      return invalidIdResponse;
    }

    const timestamp = parseInt(`${groups[3]}${groups[4]}${groups[5]}${groups[2]}${groups[1]}`, 10);
    if (isNaN(timestamp)) {
      return invalidIdResponse;
    }

    const maxTimestamp = Date.now();
    if (timestamp < maxTimestamp - maxWaitTime || timestamp > maxTimestamp) {
      return invalidIdResponse;
    }

    const resultFileUrl = await this.asyncService.findResultFileUrlWithRetry(id);
    if (!resultFileUrl) {
      return {
        success: false,
        status: 2,
      };
    }

    const result = await this.asyncService.readResult(resultFileUrl);
    if (!result) {
      return {
        success: false,
        status: 3,
        message: 'could not read result',
      };
    }

    return result;
  }
}
