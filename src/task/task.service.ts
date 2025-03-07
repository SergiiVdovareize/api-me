import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AppService } from 'src/app.service';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);
  constructor(
    private readonly appService: AppService,
  ) {}

  @Cron('0 */1 * * * *')
  handleCron() {
    // this.appService.getHello(1);
    this.logger.log('CRON CALLED');
  }
}