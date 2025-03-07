import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(mode: number = 0): string {
    console.log('AppServices called, mode:', mode);
    console.debug('(debug) AppServices called, mode:', mode);
    return 'Hello mr. Bob!';
  }
}
