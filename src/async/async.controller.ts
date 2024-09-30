import { Controller, Get, Param } from '@nestjs/common';
import { AsyncService } from './async.service';

@Controller('async')
export class AsyncController {
  constructor(private readonly asyncService: AsyncService) {}

  @Get('/result/:id')
  async result(@Param('id') id: string) {
    const maxWaitTime = 60 * 60 * 1000; // 60 minutes
    const invalidIdResponse = {
      success: false,
      status: 1,
      message: 'result id is not valid',
    };
    const reg =
      /\w{2}(\d{1})\w{2}(\d{3})\w{2}(\d{3})\w{2}(\d{3})\w{2}(\d{3})\w{2}/;
    const groups = id.match(reg);

    if (!groups || groups.length !== 6) {
      return invalidIdResponse;
    }

    const timestamp = parseInt(
      `${groups[3]}${groups[4]}${groups[5]}${groups[2]}${groups[1]}`,
      10,
    );

    if (isNaN(timestamp)) {
      return invalidIdResponse;
    }

    const maxTimestamp = Date.now();
    if (timestamp < maxTimestamp - maxWaitTime || timestamp > maxTimestamp) {
      return invalidIdResponse;
    }

    const resultFileUrl =
      await this.asyncService.findResultFileUrlWithRetry(id);
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
