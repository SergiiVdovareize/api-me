import { Controller, Get, Post, Body } from '@nestjs/common';
import { GameResultsService } from './game-results.service';
import { CreateGameResultDto } from './dto/create-game-result.dto';

@Controller('game-results')
export class GameResultsController {
  constructor(private readonly gameResultsService: GameResultsService) {}

  @Post()
  async create(@Body() createGameResultDto: CreateGameResultDto) {
    const record = await this.gameResultsService.create(createGameResultDto);
    return {
      success: !!record.id,
    };
  }

  @Get()
  findAll() {
    return this.gameResultsService.findAll();
  }
}
