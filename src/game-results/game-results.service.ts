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

  retokenize(t: string) {
    const token = decodeURIComponent(
      atob(t)
        .split('')
        .map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('')
    );

    const parts = token.toString().match(/.{1,4}/g);
    const retoken = parseInt(`${parts[1]}${parts[2]}${parts[0]}${parts[3]}`, 10);
    return retoken - 1654321;
  }
}
