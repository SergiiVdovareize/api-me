import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AppService } from 'src/app.service';

@Injectable()
export class TasksService {
//   private readonly logger = new Logger(TasksService.name);
  constructor(
    private readonly appService: AppService,
  ) {}

  @Cron('0 */1 * * * *')
  handleCron() {
    // this.appService.getHello(1);
    console.log('CRON CALLED');
  }
}