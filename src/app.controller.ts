import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { RequestsService } from './requests/requests.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly requestService: RequestsService,
  ) {}

  @Get()
  async getHello(): Promise<string> {
    await this.requestService.registerPlainApiCall();
    return this.appService.getHello();
  }
}
