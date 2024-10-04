import { Injectable } from '@nestjs/common';
import { env } from 'process';
import { AsyncService } from 'src/async/async.service';
import { RequestsService } from 'src/requests/requests.service';

const SYNC_TIMEOUT = 1000;

@Injectable()
export class CloudsService {
  constructor(
    private readonly asyncService: AsyncService,
    private readonly requestsService: RequestsService
  ) {}

  // private trackCalculations(type: number, startTime: number, result: { success: boolean, data: string}) {
  //   const data = {
  //     executionTime: Date.now() - startTime,
  //     success: !!result.success,
  //   }
  //   this.requestsService.registerApiCall(type, data);
  // }

  async getFibonacciNumber(index: number) {
    const url = `${env.FIBONACCI_URL}?index=${index}`;
    return this.getNumber(url);
  }

  async getPrimeNumber(index: number) {
    const url = `${env.PRIME_URL}?index=${index}`;
    return this.getNumber(url);
  }

  async getArmstrongNumber(index: number) {
    const url = `${env.ARMSTRONG_URL}?index=${index}`;
    return this.getNumber(url);
  }

  private async execute(url: string) {
    // const startTime = Date.now();
    const data = await fetch(url);
    const result = await data.json()
    // this.trackCalculations(startTime, result)
    return result;
  };

  private async getNumber(url: string) {
    return this.asyncService.prepareResult(this.execute.bind(this, url));
  }
}
