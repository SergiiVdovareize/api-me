import { Injectable } from '@nestjs/common';
import { env } from 'process';

@Injectable()
export class CloudsService {
    async getFibonacciNumber(index: number) {
        const url = `${env.FIBONACCI_URL}?index=${index}`
        return await this.getNumber(url)
    }

    async getPrimeNumber(index: number) {
        const url = `${env.PRIME_URL}?index=${index}`
        return await this.getNumber(url)
    }

    async getArmstrongNumber(index: number) {
        const url = `${env.ARMSTRONG_URL}?index=${index}`
        return await this.getNumber(url)
    }

    async getNumber(url: string) {
        const data = await fetch(url)
        return await data.json();
    }
}
