import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { HumanAssistService } from './human-assist.service';
import { HumanAssistGuard } from './human-assist.guard';
import { SyncPayloadDto } from './dto/sync-payload.dto';
import { SyncGetResponse, SyncPostResponse } from './interfaces/human-assist.interface';

@Controller(['human', 'api/human'])
@UseGuards(HumanAssistGuard)
export class HumanAssistController {
  constructor(private readonly humanAssistService: HumanAssistService) {}

  @Get(':userId')
  async getSync(@Param('userId') userId: string): Promise<SyncGetResponse> {
    return this.humanAssistService.getSyncData(userId);
  }

  @Post(':userId')
  @HttpCode(HttpStatus.OK)
  async saveSync(
    @Param('userId') userId: string,
    @Body() payload: SyncPayloadDto
  ): Promise<SyncPostResponse> {
    return this.humanAssistService.saveSyncData(userId, payload);
  }
}
