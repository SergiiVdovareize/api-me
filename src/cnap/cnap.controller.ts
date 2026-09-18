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
    @Query('chatId') chatId?: string
  ): Promise<CnapCheckResponse> {
    return this.cnapService.checkAndNotify({
      category,
      service,
      location,
      notify,
      chatId,
    });
  }

  @Post('check')
  async checkSlotsPost(
    @Query('category') category?: string,
    @Query('service') service?: string,
    @Query('location') location?: string,
    @Query('notify') notify?: string,
    @Query('chatId') chatId?: string
  ): Promise<CnapCheckResponse> {
    return this.cnapService.checkAndNotify({
      category,
      service,
      location,
      notify,
      chatId,
    });
  }
}
