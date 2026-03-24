import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  ParseEnumPipe,
  BadRequestException,
} from '@nestjs/common';
import { GameResultsService } from './game-results.service';
import { CreateGameResultDto } from './dto/create-game-result.dto';
import { GameType } from '../models/enums/game-type.enum';

@Controller('game-results')
export class GameResultsController {
  constructor(private readonly gameResultsService: GameResultsService) {}

  @Post()
  async create(@Body() createGameResultDto: CreateGameResultDto) {
    const { t } = createGameResultDto;

    try {
      const token = this.gameResultsService.retokenize(t);

      const diff = Math.abs(Date.now() - token);
      if (diff > 10000) {
        throw new BadRequestException('Request expired');
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('Invalid token format');
    }

    const record = await this.gameResultsService.create(createGameResultDto);
    return {
      success: !!record.id,
    };
  }

  @Get()
  findAll() {
    return this.gameResultsService.findAll();
  }

  @Get('leaders')
  getLeaders(@Query('type', new ParseEnumPipe(GameType)) type: GameType) {
    return this.gameResultsService.findLeaders(type);
  }
}
