import { Injectable, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../models/prisma/prisma.service';
import { CreateBoardDto } from './dto/create-board.dto';
import { UpdateBoardDto } from './dto/update-board.dto';
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AlphadateService {
  private readonly logger = new Logger(AlphadateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService
  ) {}

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

  private async sendCreationEmail(email: string, partners: string[], key: string): Promise<void> {
    const frontendBaseUrl =
      this.configService.get<string>('FRONTEND_BASE_URL') || 'http://localhost:3000';
    const boardLink = `${frontendBaseUrl}/#/${key}`;

    const partnersText = partners.map(name => `<strong>${name}</strong>`).join(' та ');
    const subject = 'Ваша дошка побачень AlphaDate створена! 💖';
    const html = `
      <p>Привіт!</p>
      <p>Ви успішно створили нову дошку для планування побачень AlphaDate для ${partnersText}.</p>
      <p>Щоб повернутися до вашої спільної дошки будь-коли або поділитися нею, збережіть це посилання: <a href="${boardLink}">${boardLink}</a></p>
      <p>Бажаємо незабутніх побачень!</p>
    `;

    await this.emailService.sendEmail(email, subject, html);
  }

  async create(dto: CreateBoardDto) {
    const key = await this.generateUniqueKey(5);

    const result = await this.prisma.$transaction(async tx => {
      const board = await tx.alphadateBoard.create({
        data: {
          key,
          email: dto.email,
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

      // Randomly select one of the created partner IDs
      const randomPartner = partners[Math.floor(Math.random() * partners.length)];

      const updatedBoard = await tx.alphadateBoard.update({
        where: { key: board.key },
        data: {
          currentPartnerId: randomPartner.id,
        },
      });

      return {
        ...updatedBoard,
        partners,
      };
    });

    this.sendCreationEmail(dto.email, dto.partners, key).catch(err => {
      this.logger.error(
        `Failed to send creation email in background for key ${key}: ${err.message}`,
        err.stack
      );
    });

    return result;
  }

  async getBoardState(key: string) {
    const board = await this.prisma.alphadateBoard.findUnique({
      where: { key },
      include: {
        partners: {
          orderBy: {
            turnOrder: 'asc',
          },
        },
      },
    });

    if (!board) {
      throw new NotFoundException(`Board with key ${key} not found`);
    }

    const letters = (board.letters as any) || [];

    return {
      success: true,
      letters,
      metadata: {
        partners: board.partners.map(p => ({
          id: p.id,
          name: p.name,
        })),
        currentPartnerId: board.currentPartnerId,
        pinHash: board.pin,
      },
    };
  }

  async updateBoardState(key: string, dto: UpdateBoardDto) {
    const board = await this.prisma.alphadateBoard.findUnique({
      where: { key },
    });

    if (!board) {
      throw new NotFoundException(`Board with key ${key} not found`);
    }

    const dbLetters = (board.letters as any) || [];
    const dbStatusMap = new Map<string, string>();
    for (const item of dbLetters) {
      if (item && typeof item === 'object' && item.letter) {
        dbStatusMap.set(item.letter, item.status);
      }
    }

    let hasChangedToUsed = false;
    for (const item of dto.letters) {
      const oldStatus = dbStatusMap.get(item.letter) || 'available';
      if (item.status === 'used' && oldStatus !== 'used') {
        hasChangedToUsed = true;
        break;
      }
    }

    const isFullReset =
      dto.letters.length > 0 && dto.letters.every(item => item.status === 'available');

    let nextPartnerId: number | null = board.currentPartnerId;

    await this.prisma.$transaction(async tx => {
      if (dto.metadata && dto.metadata.partners) {
        const existingPartners = await tx.alphadatePartner.findMany({
          where: { boardId: key },
          orderBy: { turnOrder: 'asc' },
        });

        const newPartners = dto.metadata.partners;
        const minLen = Math.min(existingPartners.length, newPartners.length);

        for (let i = 0; i < minLen; i++) {
          await tx.alphadatePartner.update({
            where: { id: existingPartners[i].id },
            data: { name: newPartners[i] },
          });
        }

        if (newPartners.length > existingPartners.length) {
          for (let i = minLen; i < newPartners.length; i++) {
            await tx.alphadatePartner.create({
              data: {
                boardId: key,
                name: newPartners[i],
                turnOrder: i + 1,
              },
            });
          }
        }

        if (existingPartners.length > newPartners.length) {
          const idsToDelete = existingPartners.slice(minLen).map(p => p.id);
          if (board.currentPartnerId && idsToDelete.includes(board.currentPartnerId)) {
            await tx.alphadateBoard.update({
              where: { key },
              data: { currentPartnerId: null },
            });
            nextPartnerId = null;
          }

          await tx.alphadatePartner.deleteMany({
            where: { id: { in: idsToDelete } },
          });
        }
      }

      const currentPartners = await tx.alphadatePartner.findMany({
        where: { boardId: key },
        orderBy: { turnOrder: 'asc' },
      });

      if (currentPartners.length > 0) {
        if (isFullReset) {
          const randomPartner = currentPartners[Math.floor(Math.random() * currentPartners.length)];
          nextPartnerId = randomPartner.id;
        } else if (hasChangedToUsed) {
          const currentIdToUse = nextPartnerId !== null ? nextPartnerId : board.currentPartnerId;
          const currentIndex = currentPartners.findIndex(p => p.id === currentIdToUse);
          const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % currentPartners.length;
          nextPartnerId = currentPartners[nextIndex].id;
        }
      } else {
        nextPartnerId = null;
      }

      const updateData: any = {
        letters: dto.letters as any,
        currentPartnerId: nextPartnerId,
      };

      if (dto.metadata && dto.metadata.pinHash !== undefined) {
        updateData.pin = dto.metadata.pinHash;
      }

      await tx.alphadateBoard.update({
        where: { key },
        data: updateData,
      });
    });

    return {
      success: true,
      currentPartnerId: nextPartnerId,
    };
  }

  async deleteBoard(key: string) {
    const board = await this.prisma.alphadateBoard.findUnique({
      where: { key },
    });

    if (!board) {
      throw new NotFoundException(`Board with key ${key} not found`);
    }

    await this.prisma.alphadateBoard.delete({
      where: { key },
    });

    return { success: true };
  }
}
