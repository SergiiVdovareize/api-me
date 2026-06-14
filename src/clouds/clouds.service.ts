import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AsyncService } from 'src/async/async.service';

@Injectable()
export class CloudsService {
  constructor(
    private readonly asyncService: AsyncService,
    private readonly configService: ConfigService
  ) {}

  async getFibonacciNumber(index: number) {
    const baseUrl = this.configService.get<string>('FIBONACCI_URL');
    const url = `${baseUrl}?index=${index}`;
    return this.getNumber(url);
  }

  async getPrimeNumber(index: number) {
    const baseUrl = this.configService.get<string>('PRIME_URL');
    const url = `${baseUrl}?index=${index}`;
    return this.getNumber(url);
  }

  async getArmstrongNumber(index: number) {
    const baseUrl = this.configService.get<string>('ARMSTRONG_URL');
    const url = `${baseUrl}?index=${index}`;
    return this.getNumber(url);
  }

  private async execute(url: string) {
    const data = await fetch(url);
    const result = await data.json();
    return result;
  }

  private async getNumber(url: string) {
    return this.asyncService.prepareResult(this.execute.bind(this, url));
  }
}
