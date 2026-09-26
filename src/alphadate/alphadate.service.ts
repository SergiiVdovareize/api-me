import {
  Injectable,
  ConflictException,
  Logger,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
  HttpException,
  HttpStatus,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../models/prisma/prisma.service';
import { CreateBoardDto } from './dto/create-board.dto';
import { UpdateBoardDto } from './dto/update-board.dto';
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';
import { GenderizeService } from './genderize.service';
import { LlmService } from '../llm/llm.service';
import { DateSuggestionsResponse, DateSuggestion } from './interfaces/date-suggestion.interface';
import { buildDateSuggestionsPrompt } from './prompts/date-suggestions.prompt';
import { RedisReader } from '../common/helpers/redisReader';

const SUGGESTIONS_CACHE_TTL = 3600; // 1 hour in seconds

@Injectable()
export class AlphadateService {
  private readonly logger = new Logger(AlphadateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    private readonly genderizeService: GenderizeService,
    @Optional() private readonly llmService?: LlmService,
    @Optional() private readonly redisReader?: RedisReader
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

    const genders = await this.genderizeService.detectGenders(dto.partners);
    const playerIds = this.genderizeService.assignPlayerIds(genders);

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
            playerId: playerIds[index],
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
        history: {
          include: {
            partner: true,
          },
          orderBy: {
            completedAt: 'asc',
          },
        },
      },
    });

    if (!board) {
      throw new NotFoundException(`Board with key ${key} not found`);
    }

    const letters = (board.letters as any) || [];
    const history = (board.history || []).map(h => ({
      letter: h.letter,
      partnerId: h.partnerId,
      partnerName: h.partner ? h.partner.name : null,
      playerId: h.partner ? h.partner.playerId : null,
      status: h.status,
      note: h.note,
      selectedAt: h.selectedAt,
      completedAt: h.completedAt,
    }));

    const currentPartner = board.partners.find(p => p.id === board.currentPartnerId);

    return {
      success: true,
      letters,
      history,
      metadata: {
        partners: board.partners.map(p => ({
          id: p.id,
          name: p.name,
          playerId: p.playerId,
        })),
        currentPartnerId: board.currentPartnerId,
        currentPartnerPlayerId: currentPartner ? currentPartner.playerId : null,
        currentLetter: board.currentLetter,
        currentLetterSelectedAt: board.currentLetterSelectedAt,
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
    const dbNoteMap = new Map<string, string | null>();
    for (const item of dbLetters) {
      if (item && typeof item === 'object' && item.letter) {
        dbStatusMap.set(item.letter, item.status);
        dbNoteMap.set(item.letter, item.note ?? null);
      }
    }

    const newlyUsedLetters: {
      letter: string;
      note?: string | null;
      selectedAt?: string | Date | null;
      completedAt?: string | Date | null;
    }[] = [];
    const updatedNoteLetters: {
      letter: string;
      note: string | null;
      selectedAt?: string | Date | null;
      completedAt?: string | Date | null;
    }[] = [];
    const noLongerUsedLetters: string[] = [];

    for (const item of dto.letters) {
      const oldStatus = dbStatusMap.get(item.letter) || 'available';
      const oldNote = dbNoteMap.get(item.letter);

      if (item.status === 'used' && oldStatus !== 'used') {
        newlyUsedLetters.push({
          letter: item.letter,
          note: item.note,
          selectedAt: item.selectedAt,
          completedAt: item.completedAt,
        });
      } else if (item.status === 'used' && oldStatus === 'used') {
        if (
          (item.note !== undefined && item.note !== oldNote) ||
          item.selectedAt !== undefined ||
          item.completedAt !== undefined
        ) {
          updatedNoteLetters.push({
            letter: item.letter,
            note: item.note ?? null,
            selectedAt: item.selectedAt,
            completedAt: item.completedAt,
          });
        }
      } else if (oldStatus === 'used' && item.status !== 'used') {
        noLongerUsedLetters.push(item.letter);
      }
    }

    const hasChangedToUsed = newlyUsedLetters.length > 0;

    const isFullReset =
      dto.letters.length > 0 && dto.letters.every(item => item.status === 'available');

    let nextPartnerId: number | null = board.currentPartnerId;
    let nextLetterSelectedAt: Date | null | undefined = undefined;
    let updatedPartners: any[] = [];

    await this.prisma.$transaction(async tx => {
      if (dto.metadata && dto.metadata.partners) {
        const existingPartners = await tx.alphadatePartner.findMany({
          where: { boardId: key },
          orderBy: { turnOrder: 'asc' },
        });

        const newPartners = dto.metadata.partners;
        const genders = await this.genderizeService.detectGenders(newPartners);
        const playerIds = this.genderizeService.assignPlayerIds(genders);
        const minLen = Math.min(existingPartners.length, newPartners.length);

        for (let i = 0; i < minLen; i++) {
          await tx.alphadatePartner.update({
            where: { id: existingPartners[i].id },
            data: {
              name: newPartners[i],
              playerId: playerIds[i],
            },
          });
        }

        if (newPartners.length > existingPartners.length) {
          for (let i = minLen; i < newPartners.length; i++) {
            await tx.alphadatePartner.create({
              data: {
                boardId: key,
                name: newPartners[i],
                turnOrder: i + 1,
                playerId: playerIds[i],
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
      updatedPartners = currentPartners;

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

      if (dto.currentLetter !== undefined) {
        updateData.currentLetter = dto.currentLetter;
        if (dto.currentLetter !== board.currentLetter) {
          nextLetterSelectedAt = dto.currentLetter ? new Date() : null;
          updateData.currentLetterSelectedAt = nextLetterSelectedAt;
        } else {
          nextLetterSelectedAt = board.currentLetterSelectedAt;
        }
      }

      if (dto.metadata && dto.metadata.pinHash !== undefined) {
        updateData.pin = dto.metadata.pinHash;
      }

      if (isFullReset) {
        await tx.alphadateHistory.deleteMany({
          where: { boardId: key },
        });
      } else {
        for (const item of newlyUsedLetters) {
          const letterSelectedAt = item.selectedAt
            ? new Date(item.selectedAt)
            : item.letter === board.currentLetter
              ? board.currentLetterSelectedAt || new Date()
              : new Date();
          const letterCompletedAt = item.completedAt ? new Date(item.completedAt) : new Date();

          await tx.alphadateHistory.upsert({
            where: {
              boardId_letter: {
                boardId: key,
                letter: item.letter,
              },
            },
            create: {
              boardId: key,
              letter: item.letter,
              partnerId: board.currentPartnerId,
              status: 'used',
              note: item.note || null,
              selectedAt: letterSelectedAt,
              completedAt: letterCompletedAt,
            },
            update: {
              partnerId: board.currentPartnerId,
              status: 'used',
              note: item.note || null,
              selectedAt: letterSelectedAt,
              completedAt: letterCompletedAt,
            },
          });
        }

        for (const item of updatedNoteLetters) {
          const updateData: any = {
            note: item.note,
          };
          if (item.selectedAt !== undefined) {
            updateData.selectedAt = item.selectedAt ? new Date(item.selectedAt) : null;
          }
          if (item.completedAt !== undefined) {
            updateData.completedAt = item.completedAt ? new Date(item.completedAt) : null;
          }

          await tx.alphadateHistory.updateMany({
            where: {
              boardId: key,
              letter: item.letter,
            },
            data: updateData,
          });
        }

        for (const letter of noLongerUsedLetters) {
          await tx.alphadateHistory.deleteMany({
            where: {
              boardId: key,
              letter,
            },
          });
        }
      }

      await tx.alphadateBoard.update({
        where: { key },
        data: updateData,
      });
    });

    const nextPartner = updatedPartners.find(p => p.id === nextPartnerId);

    return {
      success: true,
      currentPartnerId: nextPartnerId,
      currentPartnerPlayerId: nextPartner ? nextPartner.playerId : null,
      partners: updatedPartners.map(p => ({
        id: p.id,
        name: p.name,
        playerId: p.playerId,
      })),
      ...(nextLetterSelectedAt !== undefined && {
        currentLetterSelectedAt: nextLetterSelectedAt,
      }),
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

  /**
   * Generates date ideas for a given letter of the alphabet using AI rotator.
   * Automatically recognizes the alphabet (English / Latin or Ukrainian / Cyrillic)
   * and returns date ideas in the corresponding language.
   */
  async getSuggestions(letter: string): Promise<DateSuggestionsResponse> {
    if (!letter || typeof letter !== 'string' || !letter.trim()) {
      throw new BadRequestException('Query parameter "letter" is required');
    }

    const trimmed = letter.trim();
    if (trimmed.length !== 1) {
      throw new BadRequestException('Query parameter "letter" must be a single character');
    }

    const isLatin = /^[a-zA-Z]$/.test(trimmed);
    const isCyrillic = /^[\u0400-\u04FF]$/.test(trimmed);

    if (!isLatin && !isCyrillic) {
      throw new BadRequestException(
        'Query parameter "letter" must be a valid English or Ukrainian alphabet letter'
      );
    }

    const detectedLang: 'en' | 'uk' = isLatin ? 'en' : 'uk';
    const normalizedLetter = trimmed.toUpperCase();
    const cacheKey = `alphadate:suggestions:${normalizedLetter}:${detectedLang}`;

    if (this.redisReader) {
      try {
        const cached = await this.redisReader.read(cacheKey);
        if (cached && Array.isArray(cached.suggestions) && cached.suggestions.length > 0) {
          this.logger.log(
            `Serving date suggestions for letter "${normalizedLetter}" (${detectedLang}) from Upstash cache`
          );
          return cached;
        }
      } catch (err: any) {
        this.logger.warn(`Failed to read suggestions cache for "${cacheKey}": ${err?.message}`);
      }
    }

    if (!this.llmService) {
      throw new ServiceUnavailableException('AI date suggestion service is currently unavailable');
    }

    let data: { letter?: string; suggestions?: DateSuggestion[] };
    try {
      const { systemPrompt, userPrompt } = buildDateSuggestionsPrompt(
        normalizedLetter,
        detectedLang
      );
      data = await this.llmService.callAndParseJSON<{
        letter?: string;
        suggestions?: DateSuggestion[];
      }>(systemPrompt, userPrompt);
    } catch (error: any) {
      const errMsg = (error?.message || '').toLowerCase();
      this.logger.error(
        `Failed to generate date suggestions for letter "${normalizedLetter}": ${error.message}`,
        error.stack
      );

      const isRateLimit =
        errMsg.includes('429') ||
        errMsg.includes('rate limit') ||
        errMsg.includes('rate-limited') ||
        errMsg.includes('quota') ||
        errMsg.includes('cooldown') ||
        errMsg.includes('limit');

      if (isRateLimit) {
        throw new HttpException(
          'AI service rate limit exceeded. Please wait a few moments and try again.',
          HttpStatus.TOO_MANY_REQUESTS
        );
      }

      if (errMsg.includes('timed out') || errMsg.includes('timeout')) {
        throw new ServiceUnavailableException('AI service request timed out. Please try again.');
      }

      throw new ServiceUnavailableException(
        'Failed to get a response from AI service due to rate limits or temporary unavailability. Please try again later.'
      );
    }

    const rawSuggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
    const sanitized: DateSuggestion[] = rawSuggestions
      .filter(s => s && typeof s === 'object' && typeof s.title === 'string' && s.title.trim())
      .map(s => ({
        title: s.title.trim(),
        description: typeof s.description === 'string' ? s.description.trim() : '',
        category: s.category || 'romantic',
        estimatedCost: s.estimatedCost || 'moderate',
      }));

    if (sanitized.length === 0) {
      throw new ServiceUnavailableException(
        `AI could not generate valid date ideas for letter "${normalizedLetter}". Please try again.`
      );
    }

    const response: DateSuggestionsResponse = {
      success: true,
      letter: normalizedLetter,
      lang: detectedLang,
      suggestions: sanitized,
    };

    if (this.redisReader) {
      try {
        await this.redisReader.write(cacheKey, response, SUGGESTIONS_CACHE_TTL);
        this.logger.log(
          `Cached date suggestions for letter "${normalizedLetter}" with TTL ${SUGGESTIONS_CACHE_TTL}s`
        );
      } catch (err: any) {
        this.logger.warn(`Failed to cache date suggestions for "${cacheKey}": ${err?.message}`);
      }
    }

    return response;
  }
}
