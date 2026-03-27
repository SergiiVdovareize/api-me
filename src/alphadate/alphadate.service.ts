import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../models/prisma/prisma.service';
import { CreateBoardDto } from './dto/create-board.dto';

@Injectable()
export class AlphadateService {
  constructor(private readonly prisma: PrismaService) {}

  private generateRandomKey(length: number): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  private async generateUniqueKey(length: number): Promise<string> {
    let key = '';
    let exists = true;
    let attempts = 0;
    while (exists && attempts < 10) {
      key = this.generateRandomKey(length);
      const board = await this.prisma.alphadateBoard.findUnique({
        where: { key },
      });
      if (!board) {
        exists = false;
      }
      attempts++;
    }
    if (exists) {
      throw new ConflictException('Could not generate a unique key after multiple attempts');
    }
    return key;
  }

  async create(dto: CreateBoardDto) {
    const key = await this.generateUniqueKey(5);

    return this.prisma.$transaction(async tx => {
      const board = await tx.alphadateBoard.create({
        data: {
          key,
          settings: {},
        },
      });

      const partnerPromises = dto.partners.map((name, index) => {
        return tx.alphadatePartner.create({
          data: {
            boardId: board.key,
            name,
            turnOrder: index + 1,
          },
        });
      });

      const partners = await Promise.all(partnerPromises);

      return {
        ...board,
        partners,
      };
    });
  }
}
