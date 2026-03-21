import { Injectable } from '@nestjs/common';
import { PrismaService } from '../models/prisma/prisma.service';
import { CreateGameResultDto } from './dto/create-game-result.dto';
import { GameType } from '../models/enums/game-type.enum';

@Injectable()
export class GameResultsService {
  constructor(private prisma: PrismaService) {}

  async create(createGameResultDto: CreateGameResultDto) {
    return this.prisma.gameResult.create({
      data: {
        gameType: createGameResultDto.gameType,
        name: createGameResultDto.name,
        result: createGameResultDto.result,
      },
    });
  }

  async findAll() {
    return this.prisma.gameResult.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findLeaders(gameType: GameType, limit: number = 5) {
    return this.prisma.gameResult.findMany({
      where: {
        gameType,
      },
      orderBy: {
        result: 'desc',
      },
      take: limit,
    });
  }
}
