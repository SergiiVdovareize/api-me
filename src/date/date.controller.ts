import { Controller, Get } from '@nestjs/common';
import { DateService } from './date.service';

@Controller('date')
export class DateController {
  constructor(private readonly dateService: DateService) {}

  @Get()
  async getRandomDate(): Promise<{ success: true; date: string }> {
    const date = await this.dateService.getRandomDate();
    return { success: true, date };
  }
}
