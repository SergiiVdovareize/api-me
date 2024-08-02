import { Injectable } from '@nestjs/common';
import { put, del, list } from '@vercel/blob';
import { uid } from 'uid';
import { env } from 'process';

const SYNC_TIMEOUT = 1000;

@Injectable()
export class CloudsService {
    async getFibonacciNumber(index: number) {
        const url = `${env.FIBONACCI_URL}?index=${index}`
        return this.prepareResult(url);
    }

    async getPrimeNumber(index: number) {
        const url = `${env.PRIME_URL}?index=${index}`
        return this.prepareResult(url);
    }

    async getArmstrongNumber(index: number) {
        const url = `${env.ARMSTRONG_URL}?index=${index}`;
        return this.prepareResult(url);
    }

    async prepareResult(url: string) {
        const result: { type: 'sync'|'async', data: string|object } = { type: null, data: null };
        return new Promise((resolve, reject) => {
            const fileName = this.generateFilename();

            const resolveTimeoutId = setTimeout(() => {
                if (result.type == 'sync') {
                    return
                }

                result.type = 'async'
                result.data = fileName
                resolve(result)
            }, SYNC_TIMEOUT)

            this.getNumber(url).then(data => {
                if (result.type == 'async') {
                    this.createResultFile(fileName, data)
                } else {
                    clearTimeout(resolveTimeoutId);
                    result.type = 'sync'
                    result.data = data
                    resolve(result)
                }
            })
        })
    }

    generateFilename() {
        const base = Date.now().toString().match(/.{1,3}/g).reverse()
        const fileName = `${uid(2)}${base[0]}${uid(2)}${base[1]}${uid(2)}${base[2]}${uid(2)}${base[3]}${uid(2)}${base[4]}${uid(2)}`
        return fileName;
    }

    async getNumber(url: string) {
        const data = await fetch(url)
        return await data.json();
    }

    async createResultFile(filename: string, data: JSON): Promise<string> {
        const blob = await put(filename, JSON.stringify(data), {
          access: 'public',
          contentType: 'application/json',
        });
    
        return blob.url;
    }
}
