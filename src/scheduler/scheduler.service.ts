import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly apiUrl = process.env.API_URL || 'http://localhost:3000';

  @Interval(30000) // 30 seconds
  async callRootApi() {
    try {
        console.log('SchedulerService: callRootApi invoked', new Date().toISOString());
      this.logger.log('Calling root API endpoint...');
      const response = await fetch(`${this.apiUrl}/`);
      const data = await response.text();
      this.logger.log(`Root API response: ${data}`);
    } catch (error) {
      this.logger.error('Error calling root API:', error);
    }
  }
}
