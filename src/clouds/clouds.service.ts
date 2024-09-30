import { Injectable } from '@nestjs/common';
import { env } from 'process';
import { AsyncService } from 'src/async/async.service';

const SYNC_TIMEOUT = 1000;

@Injectable()
export class CloudsService {
  constructor(private readonly asyncService: AsyncService) {}

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

  async getNumber(url: string) {
    const execute = async () => {
      const data = await fetch(url);
      return await data.json();
    };

    return this.asyncService.prepareResult(execute);
  }
}
