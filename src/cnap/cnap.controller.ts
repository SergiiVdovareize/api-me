import { Controller, Get, Post, Query, Body } from '@nestjs/common';
import { CnapService } from './cnap.service';
import { CnapCheckResponse } from './interfaces/cnap.interface';
import { CheckCnapDto } from './dto/check-cnap.dto';

@Controller('cnap')
export class CnapController {
  constructor(private readonly cnapService: CnapService) {}

  @Get('check')
  async checkSlotsGet(
    @Query('category') category?: string,
    @Query('service') service?: string,
    @Query('location') location?: string,
    @Query('notify') notify?: string,
    @Query('force') force?: string,
    @Query('chatId') chatId?: string
  ): Promise<CnapCheckResponse> {
    return this.cnapService.checkAndNotify({
      category,
      service,
      location,
      notify,
      force,
      chatId,
    });
  }

  @Post('check')
  async checkSlotsPost(@Body() dto: CheckCnapDto): Promise<CnapCheckResponse> {
    return this.cnapService.checkAndNotify({
      category: dto?.category,
      service: dto?.service,
      location: dto?.location,
      notify: dto?.notify,
      force: dto?.force,
      chatId: dto?.chatId,
    });
  }

  /**
   * Тестовий ендпоінт для перевірки роботи системи на категорії з наявними слотами
   * (Оформлення відстрочки -> Подати документи). За замовчуванням НЕ надсилає повідомлення в Telegram.
   */
  @Get('test')
  async checkTestSlots(
    @Query('notify') notify = 'false',
    @Query('force') force?: string
  ): Promise<CnapCheckResponse> {
    return this.cnapService.checkAndNotify({
      category: 'Оформлення відстрочки',
      service: 'Подати документи',
      location: 'Хвильового',
      notify,
      force,
    });
  }
}
