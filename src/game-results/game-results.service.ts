import { Injectable } from '@nestjs/common';
import { PrismaService } from '../models/prisma/prisma.service';
import { CreateGameResultDto } from './dto/create-game-result.dto';

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
}
