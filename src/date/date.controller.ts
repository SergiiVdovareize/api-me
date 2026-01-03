import { Controller, Get } from '@nestjs/common';
import { DateService } from './date.service';

@Controller('date')
export class DateController {
  constructor(private readonly dateService: DateService) {}

  @Get()
  async getRandomDate(): Promise<{ success: boolean; date: string }> {
    const date = await this.dateService.getRandomDate();
    return date ? { success: true, date } : { success: false, date: null };
  }
}
