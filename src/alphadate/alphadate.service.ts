import {
  Injectable,
  ConflictException,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
  ServiceUnavailableException,
  HttpException,
  HttpStatus,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../models/prisma/prisma.service';
import { CreateBoardDto } from './dto/create-board.dto';
import { UpdateBoardDto } from './dto/update-board.dto';
import { RecoverBoardDto } from './dto/recover-board.dto';
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';
import { GenderizeService } from './genderize.service';
import { LlmService } from '../llm/llm.service';
import { DateSuggestionsResponse, DateSuggestion } from './interfaces/date-suggestion.interface';
import { buildDateSuggestionsPrompt } from './prompts/date-suggestions.prompt';
import { RedisReader } from '../common/helpers/redisReader';
import { BlobService } from '../blob/blob.service';
import { hashPin, verifyPin } from './utils/pin.util';
import {
  renderCreationEmail,
  renderRecoveryEmail,
  formatPartnersWithNbsp,
} from './templates/alphadate-email.template';

const SUGGESTIONS_CACHE_TTL = 3600; // 1 hour in seconds
const BOARD_CACHE_TTL = 86400; // 24 hours in seconds

interface CachedBoardData {
  response: {
    success: boolean;
    letters: any[];
    history: any[];
    metadata: {
      partners: Array<{ id: number; name: string; playerId: number | null }>;
      currentPartnerId: number | null;
      currentPartnerPlayerId: number | null;
      currentLetter: string | null;
      currentLetterSelectedAt: Date | string | null;
      hasPin: boolean;
    };
  };
  storedPin: string | null;
}

@Injectable()
export class AlphadateService {
  private readonly logger = new Logger(AlphadateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    private readonly genderizeService: GenderizeService,
    @Optional() private readonly llmService?: LlmService,
    @Optional() private readonly redisReader?: RedisReader,
    @Optional() private readonly blobService?: BlobService
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

  private async sendCreationEmail(
    email: string,
    partners: string[],
    key: string,
    pin?: string | null
  ): Promise<void> {
    const frontendBaseUrl =
      this.configService.get<string>('FRONTEND_BASE_URL') || 'http://localhost:3000';
    const boardLink = `${frontendBaseUrl}/#/${key}`;

    const subject = 'Ваша дошка побачень AlphaDate створена! 💖';
    const html = renderCreationEmail({
      partners,
      boardLink,
      pin,
    });

    await this.emailService.sendEmail(email, subject, html);
  }

  private async sendRecoveryEmail(
    email: string,
    boards: Array<{ key: string; partners: Array<{ name: string }> }>
  ): Promise<void> {
    const frontendBaseUrl =
      this.configService.get<string>('FRONTEND_BASE_URL') || 'http://localhost:3000';

    const isMultiple = boards.length > 1;
    const subject = isMultiple
      ? 'Відновлення доступу до ваших дошок AlphaDate 💖'
      : 'Відновлення доступу до вашої дошки AlphaDate 💖';

    const formattedBoards = boards.map(b => {
      const boardLink = `${frontendBaseUrl}/#/${b.key}`;
      const partnersText =
        b.partners && b.partners.length > 0
          ? formatPartnersWithNbsp(b.partners.map(p => p.name))
          : '';
      return {
        key: b.key,
        boardLink,
        partnersText,
      };
    });

    const html = renderRecoveryEmail({
      boards: formattedBoards,
    });

    await this.emailService.sendEmail(email, subject, html);
  }

  private async invalidateBoardCache(key: string): Promise<void> {
    if (!this.redisReader) return;
    const trimmedKey = (key || '').trim();
    if (!trimmedKey) return;
    const cacheKey = `alphadate:board:${trimmedKey}`;
    try {
      await this.redisReader.delete(cacheKey);
      this.logger.log(`Invalidated board cache for key: "${trimmedKey}"`);
    } catch (err: any) {
      this.logger.warn(`Failed to invalidate board cache for "${trimmedKey}": ${err?.message}`);
    }
  }

  private async processPhoto(
    key: string,
    letter: string,
    photo?: string | null
  ): Promise<string | null> {
    if (!photo) return null;
    const trimmed = photo.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed;
    }
    if (trimmed.startsWith('data:')) {
      const matches = trimmed.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) {
        this.logger.warn(`Invalid Data URL photo format for board "${key}" letter "${letter}"`);
        return null;
      }
      const contentType = matches[1].toLowerCase();
      const base64Data = matches[2];
      const buffer = Buffer.from(base64Data, 'base64');
      const ext = contentType.includes('png')
        ? 'png'
        : contentType.includes('jpeg') || contentType.includes('jpg')
          ? 'jpg'
          : 'webp';
      const safeLetter = encodeURIComponent(letter);
      const pathname = `alphadate/${key}/${safeLetter}.${ext}`;
      if (this.blobService) {
        try {
          const url = await this.blobService.upload(pathname, buffer, contentType);
          this.logger.log(`Uploaded photo for board "${key}" letter "${letter}" to ${url}`);
          return url;
        } catch (err: any) {
          this.logger.error(
            `Failed to upload photo for board "${key}" letter "${letter}": ${err?.message}`
          );
          return null;
        }
      }
    }
    return null;
  }

  verifyBoardAccess(board: { pin: string | null }, providedPin?: string | null): void {
    if (!board.pin) {
      return;
    }

    if (!providedPin || typeof providedPin !== 'string' || !providedPin.trim()) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'Board is protected by PIN code',
        isPinRequired: true,
      });
    }

    if (!verifyPin(providedPin.trim(), board.pin)) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'Invalid PIN code',
        isPinRequired: true,
      });
    }
  }

  async create(dto: CreateBoardDto) {
    const key = await this.generateUniqueKey(5);

    const genders = await this.genderizeService.detectGenders(dto.partners);
    const playerIds = this.genderizeService.assignPlayerIds(genders);

    let pinToStore: string | null = null;
    if (dto.pin && typeof dto.pin === 'string' && dto.pin.trim()) {
      pinToStore = hashPin(dto.pin.trim());
    }

    const result = await this.prisma.$transaction(async tx => {
      const board = await tx.alphadateBoard.create({
        data: {
          key,
          email: dto.email,
          pin: pinToStore,
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

    this.sendCreationEmail(dto.email, dto.partners, key, dto.pin).catch(err => {
      this.logger.error(
        `Failed to send creation email in background for key ${key}: ${err.message}`,
        err.stack
      );
    });

    return result;
  }

  async recover(dto: RecoverBoardDto): Promise<{ success: true }> {
    const normalizedEmail = dto.email.trim().toLowerCase();

    const boards = await this.prisma.alphadateBoard.findMany({
      where: {
        email: {
          equals: normalizedEmail,
          mode: 'insensitive',
        },
      },
      include: {
        partners: {
          orderBy: {
            turnOrder: 'asc',
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (boards.length > 0) {
      try {
        await this.sendRecoveryEmail(dto.email.trim(), boards);
      } catch (err: any) {
        this.logger.error(
          `Failed to send recovery email for ${dto.email}: ${err?.message}`,
          err?.stack
        );
      }
    } else {
      this.logger.log(
        `Recovery requested for email with no associated boards (enumeration prevention).`
      );
    }

    return { success: true };
  }

  async getBoardState(key: string, pin?: string) {
    const trimmedKey = (key || '').trim();
    const cacheKey = `alphadate:board:${trimmedKey}`;

    if (this.redisReader && trimmedKey) {
      try {
        const cached: CachedBoardData | null = await this.redisReader.read(cacheKey);
        if (cached && cached.response && cached.response.metadata) {
          this.verifyBoardAccess({ pin: cached.storedPin }, pin);
          this.logger.log(`Serving board state for "${trimmedKey}" from Upstash cache`);
          return cached.response;
        }
      } catch (err: any) {
        if (err instanceof UnauthorizedException) {
          throw err;
        }
        this.logger.warn(`Failed to read board cache for "${cacheKey}": ${err?.message}`);
      }
    }

    const board = await this.prisma.alphadateBoard.findUnique({
      where: { key: trimmedKey },
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

    this.verifyBoardAccess(board, pin);

    const letters = (board.letters as any) || [];
    const history = (board.history || []).map(h => ({
      letter: h.letter,
      partnerId: h.partnerId,
      partnerName: h.partner ? h.partner.name : null,
      playerId: h.partner ? h.partner.playerId : null,
      status: h.status,
      note: h.note,
      photo: h.photo,
      selectedAt: h.selectedAt,
      completedAt: h.completedAt,
    }));

    const currentPartner = board.partners.find(p => p.id === board.currentPartnerId);

    const response = {
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
        hasPin: Boolean(board.pin),
      },
    };

    if (this.redisReader && trimmedKey) {
      try {
        const cacheData: CachedBoardData = {
          response,
          storedPin: board.pin,
        };
        await this.redisReader.write(cacheKey, cacheData, BOARD_CACHE_TTL);
        this.logger.log(`Cached board state for "${trimmedKey}" with TTL ${BOARD_CACHE_TTL}s`);
      } catch (err: any) {
        this.logger.warn(`Failed to cache board state for "${cacheKey}": ${err?.message}`);
      }
    }

    return response;
  }

  async updateBoardState(key: string, dto: UpdateBoardDto, pin?: string) {
    const board = await this.prisma.alphadateBoard.findUnique({
      where: { key },
    });

    if (!board) {
      throw new NotFoundException(`Board with key ${key} not found`);
    }

    this.verifyBoardAccess(board, pin);

    const dbLetters = (board.letters as any) || [];
    const dbStatusMap = new Map<string, string>();
    const dbNoteMap = new Map<string, string | null>();
    const dbPhotoMap = new Map<string, string | null | undefined>();
    for (const item of dbLetters) {
      if (item && typeof item === 'object' && item.letter) {
        dbStatusMap.set(item.letter, item.status);
        dbNoteMap.set(item.letter, item.note ?? null);
        dbPhotoMap.set(item.letter, item.photo !== undefined ? item.photo : undefined);
      }
    }

    const processedLetters = await Promise.all(
      dto.letters.map(async item => {
        const oldPhoto = dbPhotoMap.get(item.letter);
        let photoUrl: string | null | undefined = oldPhoto;

        if (item.photo !== undefined) {
          if (item.photo && item.photo.startsWith('data:')) {
            photoUrl = await this.processPhoto(key, item.letter, item.photo);
            if (oldPhoto && oldPhoto !== photoUrl && oldPhoto.includes('vercel-storage.com')) {
              this.blobService?.remove(oldPhoto).catch(() => {});
            }
          } else if (
            item.photo &&
            (item.photo.startsWith('http://') || item.photo.startsWith('https://'))
          ) {
            photoUrl = item.photo;
          } else if (!item.photo) {
            photoUrl = null;
            if (oldPhoto && oldPhoto.includes('vercel-storage.com')) {
              this.blobService?.remove(oldPhoto).catch(() => {});
            }
          }
        }

        const letterObj: any = {
          ...item,
        };
        if (photoUrl !== undefined) {
          letterObj.photo = photoUrl;
        }

        return letterObj;
      })
    );

    const newlyUsedLetters: {
      letter: string;
      note?: string | null;
      photo?: string | null;
      selectedAt?: string | Date | null;
      completedAt?: string | Date | null;
    }[] = [];
    const updatedNoteLetters: {
      letter: string;
      note: string | null;
      photo?: string | null;
      selectedAt?: string | Date | null;
      completedAt?: string | Date | null;
    }[] = [];
    const noLongerUsedLetters: string[] = [];

    for (const item of processedLetters) {
      const oldStatus = dbStatusMap.get(item.letter) || 'available';
      const oldNote = dbNoteMap.get(item.letter);
      const oldPhoto = dbPhotoMap.get(item.letter);

      if (item.status === 'used' && oldStatus !== 'used') {
        newlyUsedLetters.push({
          letter: item.letter,
          note: item.note,
          photo: item.photo,
          selectedAt: item.selectedAt,
          completedAt: item.completedAt,
        });
      } else if (item.status === 'used' && oldStatus === 'used') {
        if (
          (item.note !== undefined && item.note !== oldNote) ||
          (item.photo !== undefined && item.photo !== oldPhoto) ||
          item.selectedAt !== undefined ||
          item.completedAt !== undefined
        ) {
          updatedNoteLetters.push({
            letter: item.letter,
            note: item.note ?? null,
            photo: item.photo !== undefined ? item.photo : oldPhoto,
            selectedAt: item.selectedAt,
            completedAt: item.completedAt,
          });
        }
      } else if (oldStatus === 'used' && item.status !== 'used') {
        noLongerUsedLetters.push(item.letter);
        if (oldPhoto && oldPhoto.includes('vercel-storage.com')) {
          this.blobService?.remove(oldPhoto).catch(() => {});
        }
      }
    }

    const hasChangedToUsed = newlyUsedLetters.length > 0;

    const isFullReset =
      processedLetters.length > 0 && processedLetters.every(item => item.status === 'available');

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
        letters: processedLetters as any,
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

      if (dto.metadata && dto.metadata.pin !== undefined) {
        updateData.pin = dto.metadata.pin ? hashPin(dto.metadata.pin) : null;
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
              photo: item.photo || null,
              selectedAt: letterSelectedAt,
              completedAt: letterCompletedAt,
            },
            update: {
              partnerId: board.currentPartnerId,
              status: 'used',
              note: item.note || null,
              photo: item.photo || null,
              selectedAt: letterSelectedAt,
              completedAt: letterCompletedAt,
            },
          });
        }

        for (const item of updatedNoteLetters) {
          const updateData: any = {
            note: item.note,
          };
          if (item.photo !== undefined) {
            updateData.photo = item.photo;
          }
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

    await this.invalidateBoardCache(key);

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

  async deleteBoard(key: string, pin?: string) {
    const board = await this.prisma.alphadateBoard.findUnique({
      where: { key },
      include: {
        history: true,
      },
    });

    if (!board) {
      throw new NotFoundException(`Board with key ${key} not found`);
    }

    this.verifyBoardAccess(board, pin);

    if (this.blobService && board.history) {
      for (const h of board.history) {
        if (h.photo && h.photo.includes('vercel-storage.com')) {
          this.blobService.remove(h.photo).catch(() => {});
        }
      }
    }

    await this.prisma.alphadateBoard.delete({
      where: { key },
    });

    await this.invalidateBoardCache(key);

    return { success: true };
  }

  /**
   * Generates date ideas for a given letter of the alphabet for a specific board using AI rotator.
   * Validates board existence (returns 403 Forbidden if not found).
   * Automatically recognizes the alphabet (English / Latin or Ukrainian / Cyrillic)
   * and returns date ideas in the corresponding language with board-level caching.
   */
  async getSuggestions(
    key: string,
    letter: string,
    pin?: string
  ): Promise<DateSuggestionsResponse> {
    if (!key || typeof key !== 'string' || !key.trim()) {
      throw new BadRequestException('Board key is required');
    }

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

    const trimmedKey = key.trim();
    const board = await this.prisma.alphadateBoard.findUnique({
      where: { key: trimmedKey },
    });

    if (!board) {
      throw new ForbiddenException('Access denied: board not found or invalid');
    }

    this.verifyBoardAccess(board, pin);

    const detectedLang: 'en' | 'uk' = isLatin ? 'en' : 'uk';
    const normalizedLetter = trimmed.toUpperCase();
    const cacheKey = `alphadate:suggestions:${trimmedKey}:${normalizedLetter}:${detectedLang}`;

    if (this.redisReader) {
      try {
        const cached = await this.redisReader.read(cacheKey);
        if (cached && Array.isArray(cached.suggestions)) {
          this.logger.log(
            `Serving date suggestions for board "${trimmedKey}" letter "${normalizedLetter}" (${detectedLang}) from Upstash cache`
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
      .filter(s => s.title.trim().toUpperCase().startsWith(normalizedLetter))
      .map(s => ({
        title: s.title.trim(),
        description: typeof s.description === 'string' ? s.description.trim() : '',
        category: s.category || 'romantic',
        estimatedCost: s.estimatedCost || 'moderate',
      }));

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
          `Cached date suggestions for board "${trimmedKey}" letter "${normalizedLetter}" with TTL ${SUGGESTIONS_CACHE_TTL}s`
        );
      } catch (err: any) {
        this.logger.warn(`Failed to cache date suggestions for "${cacheKey}": ${err?.message}`);
      }
    }

    return response;
  }
}
