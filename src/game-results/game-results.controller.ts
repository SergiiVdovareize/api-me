import { Controller, Get, Post, Body } from '@nestjs/common';
import { GameResultsService } from './game-results.service';
import { CreateGameResultDto } from './dto/create-game-result.dto';

@Controller('game-results')
export class GameResultsController {
  constructor(private readonly gameResultsService: GameResultsService) {}

  @Post()
  create(@Body() createGameResultDto: CreateGameResultDto) {
    return this.gameResultsService.create(createGameResultDto);
  }

  @Get()
  findAll() {
    return this.gameResultsService.findAll();
  }
}
