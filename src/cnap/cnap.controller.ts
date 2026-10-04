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
  async checkSlotsPost(
    @Body() bodyOrCategory?: CheckCnapDto | string,
    @Query('service') serviceParam?: string,
    @Query('location') locationParam?: string,
    @Query('notify') notifyParam?: string,
    @Query('force') forceParam?: string,
    @Query('chatId') chatIdParam?: string
  ): Promise<CnapCheckResponse> {
    const isBodyObject =
      bodyOrCategory !== null &&
      typeof bodyOrCategory === 'object' &&
      !Array.isArray(bodyOrCategory);

    const category = isBodyObject
      ? (bodyOrCategory as CheckCnapDto).category
      : (bodyOrCategory as string | undefined);
    const service = isBodyObject ? (bodyOrCategory as CheckCnapDto).service : serviceParam;
    const location = isBodyObject ? (bodyOrCategory as CheckCnapDto).location : locationParam;
    const notify = isBodyObject ? (bodyOrCategory as CheckCnapDto).notify : notifyParam;
    const force = isBodyObject ? (bodyOrCategory as CheckCnapDto).force : forceParam;
    const chatId = isBodyObject ? (bodyOrCategory as CheckCnapDto).chatId : chatIdParam;

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
