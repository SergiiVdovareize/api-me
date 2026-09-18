import { Controller, Get, Post, Query } from '@nestjs/common';
import { CnapService } from './cnap.service';
import { CnapCheckResponse } from './interfaces/cnap.interface';

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
  async checkSlotsPost(
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
