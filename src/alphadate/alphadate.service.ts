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
    const frontendBaseUrl = this.configService.get<string>('FRONTEND_BASE_URL') || 'http://localhost:3000';
    const boardLink = `${frontendBaseUrl}/#/${key}`;

    const partnersText = partners.join(' та ');
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

      return {
        ...board,
        partners,
      };
    });

    this.sendCreationEmail(dto.email, dto.partners, key).catch(err => {
      this.logger.error(`Failed to send creation email in background for key ${key}: ${err.message}`, err.stack);
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
        partners: board.partners.map(p => p.name),
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

    await this.prisma.$transaction(async tx => {
      await tx.alphadateBoard.update({
        where: { key },
        data: {
          letters: dto.letters as any,
          pin: dto.metadata.pinHash,
        },
      });

      await tx.alphadateBoard.update({
        where: { key },
        data: {
          currentPartnerId: null,
        },
      });

      await tx.alphadatePartner.deleteMany({
        where: { boardId: key },
      });

      const partnerPromises = dto.metadata.partners.map((name, index) => {
        return tx.alphadatePartner.create({
          data: {
            boardId: key,
            name,
            turnOrder: index + 1,
          },
        });
      });

      await Promise.all(partnerPromises);
    });

    return { success: true };
  }
}
