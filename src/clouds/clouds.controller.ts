import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { CloudsService } from './clouds.service';
import { RequestsService } from 'src/requests/requests.service';
import { AsyncService } from 'src/async/async.service';
import { CLOUDS_CONSTANTS } from './clouds.constants';

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
    if (count >= CLOUDS_CONSTANTS.LIMIT_MAP.FIBONACCI) {
      return CLOUDS_CONSTANTS.limitedResponse;
    }

    await this.requestsService.registerFibonacciApiCall();
    return this.cloudsService.getFibonacciNumber(index);
  }

  @Get('/prime/:index')
  async prime(@Param('index', ParseIntPipe) index: number) {
    const count = await this.requestsService.countPrimeThisMonth();
    if (count >= CLOUDS_CONSTANTS.LIMIT_MAP.PRIME) {
      return CLOUDS_CONSTANTS.limitedResponse;
    }

    await this.requestsService.registerPrimeApiCall();
    return this.cloudsService.getPrimeNumber(index);
  }

  @Get('/armstrong/:index')
  async armstrong(@Param('index', ParseIntPipe) index: number) {
    const count = await this.requestsService.countArmstrongThisMonth();
    if (count >= CLOUDS_CONSTANTS.LIMIT_MAP.ARMSTRONG) {
      return CLOUDS_CONSTANTS.limitedResponse;
    }

    await this.requestsService.registerArmstrongApiCall();
    return this.cloudsService.getArmstrongNumber(index);
  }

  // TODO: DEPRECATED, remove this method soon
  @Get('/result/:id')
  async result(@Param('id') id: string) {
    const invalidIdResponse = {
      success: false,
      status: 1,
      message: 'result id is not valid',
    };
    const groups = id.match(CLOUDS_CONSTANTS.ID_REGEX);

    if (!groups || groups.length !== 6) {
      return invalidIdResponse;
    }

    const timestamp = parseInt(`${groups[3]}${groups[4]}${groups[5]}${groups[2]}${groups[1]}`, 10);
    if (isNaN(timestamp)) {
      return invalidIdResponse;
    }

    const maxTimestamp = Date.now();
    if (timestamp < maxTimestamp - CLOUDS_CONSTANTS.MAX_WAIT_TIME || timestamp > maxTimestamp) {
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
