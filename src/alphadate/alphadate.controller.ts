import {
  Controller,
  Post,
  Body,
  Get,
  Put,
  Delete,
  Param,
  Query,
  Headers,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AlphadateService } from './alphadate.service';
import { CreateBoardDto } from './dto/create-board.dto';
import { RecoverBoardDto } from './dto/recover-board.dto';

@Controller('alphadate')
export class AlphadateController {
  constructor(private readonly alphadateService: AlphadateService) {}

  @Post()
  async create(@Body() createBoardDto: CreateBoardDto) {
    const result = await this.alphadateService.create(createBoardDto);
    return {
      success: true,
      key: result.key,
    };
  }

  @Post('recover')
  @HttpCode(HttpStatus.OK)
  async recover(@Body() recoverBoardDto: RecoverBoardDto) {
    if (
      !recoverBoardDto ||
      typeof recoverBoardDto !== 'object' ||
      !recoverBoardDto.email ||
      typeof recoverBoardDto.email !== 'string' ||
      !recoverBoardDto.email.trim()
    ) {
      throw new BadRequestException('Email is required');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recoverBoardDto.email.trim())) {
      throw new BadRequestException('Invalid email format');
    }

    return this.alphadateService.recover(recoverBoardDto);
  }

  @Get(':key/suggestions')
  async getSuggestions(
    @Param('key') key: string,
    @Query('letter') letter: string,
    @Headers('x-board-pin') pinHeader?: string
  ) {
    if (!key || typeof key !== 'string' || !key.trim()) {
      throw new BadRequestException('Board key is required');
    }
    if (!letter || typeof letter !== 'string' || !letter.trim()) {
      throw new BadRequestException('Query parameter "letter" is required');
    }
    if (letter.trim().length !== 1) {
      throw new BadRequestException('Query parameter "letter" must be a single character');
    }
    return pinHeader
      ? this.alphadateService.getSuggestions(key, letter, pinHeader)
      : this.alphadateService.getSuggestions(key, letter);
  }

  @Get(':key/suggestions/:letter')
  async getSuggestionsByParam(
    @Param('key') key: string,
    @Param('letter') letter: string,
    @Headers('x-board-pin') pinHeader?: string
  ) {
    if (!key || typeof key !== 'string' || !key.trim()) {
      throw new BadRequestException('Board key is required');
    }
    if (!letter || typeof letter !== 'string' || !letter.trim()) {
      throw new BadRequestException('Parameter "letter" is required');
    }
    if (letter.trim().length !== 1) {
      throw new BadRequestException('Parameter "letter" must be a single character');
    }
    return pinHeader
      ? this.alphadateService.getSuggestions(key, letter, pinHeader)
      : this.alphadateService.getSuggestions(key, letter);
  }

  @Get(':key')
  async getBoardState(@Param('key') key: string, @Headers('x-board-pin') pinHeader?: string) {
    return pinHeader
      ? this.alphadateService.getBoardState(key, pinHeader)
      : this.alphadateService.getBoardState(key);
  }

  @Put(':key')
  async updateBoardState(
    @Param('key') key: string,
    @Body() body: any,
    @Headers('x-board-pin') pinHeader?: string
  ) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Request body must be a JSON object');
    }

    const { letters, metadata, currentLetter } = body;

    if (!letters || !Array.isArray(letters)) {
      throw new BadRequestException('letters must be an array');
    }

    if (currentLetter !== undefined && currentLetter !== null) {
      if (typeof currentLetter !== 'string' || currentLetter.length !== 1) {
        throw new BadRequestException('currentLetter must be a single-character string or null');
      }
    }

    for (const item of letters) {
      if (!item || typeof item !== 'object') {
        throw new BadRequestException('Each letter state must be an object');
      }
      if (typeof item.letter !== 'string' || !item.letter.trim()) {
        throw new BadRequestException('Each letter state must contain a non-empty letter string');
      }
      if (!['available', 'used', 'excluded', 'skipped'].includes(item.status)) {
        throw new BadRequestException(
          `Status must be one of: available, used, excluded, skipped. Received: ${item.status}`
        );
      }
      if (item.note !== undefined && item.note !== null && typeof item.note !== 'string') {
        throw new BadRequestException('Letter note must be a string or null');
      }
      if (item.photo !== undefined && item.photo !== null && typeof item.photo !== 'string') {
        throw new BadRequestException('Letter photo must be a string or null');
      }
    }

    let parsedPartners: string[] | undefined = undefined;
    let parsedPin: string | null | undefined = undefined;

    if (metadata !== undefined && metadata !== null) {
      if (typeof metadata !== 'object' || Array.isArray(metadata)) {
        throw new BadRequestException('metadata must be a JSON object');
      }

      const { partners, pin } = metadata;

      if (partners !== undefined) {
        if (!Array.isArray(partners) || partners.length === 0) {
          throw new BadRequestException('metadata.partners must be a non-empty array');
        }

        parsedPartners = [];
        for (const partner of partners) {
          if (typeof partner === 'string' && partner.trim()) {
            parsedPartners.push(partner.trim());
          } else if (
            partner &&
            typeof partner === 'object' &&
            typeof partner.name === 'string' &&
            partner.name.trim()
          ) {
            parsedPartners.push(partner.name.trim());
          } else {
            throw new BadRequestException(
              'Each partner must be a non-empty string or an object with a non-empty name'
            );
          }
        }
      }

      if (pin !== undefined) {
        if (pin !== null && (typeof pin !== 'string' || !/^\d{4}$/.test(pin.trim()))) {
          throw new BadRequestException('metadata.pin must be a 4-digit string or null');
        }
        parsedPin = pin !== null ? pin.trim() : null;
      }
    }

    const updateBoardDto: any = {
      letters: letters.map(item => ({
        letter: item.letter.trim(),
        status: item.status,
        ...(item.note !== undefined && {
          note: typeof item.note === 'string' ? item.note.trim() : null,
        }),
        ...(item.photo !== undefined && {
          photo: typeof item.photo === 'string' ? item.photo.trim() : null,
        }),
      })),
    };

    if (currentLetter !== undefined) {
      updateBoardDto.currentLetter = currentLetter;
    }

    if (parsedPartners !== undefined || parsedPin !== undefined) {
      updateBoardDto.metadata = {};
      if (parsedPartners !== undefined) {
        updateBoardDto.metadata.partners = parsedPartners;
      }
      if (parsedPin !== undefined) {
        updateBoardDto.metadata.pin = parsedPin;
      }
    }

    const result = pinHeader
      ? await this.alphadateService.updateBoardState(key, updateBoardDto, pinHeader)
      : await this.alphadateService.updateBoardState(key, updateBoardDto);

    return {
      success: true,
      currentPartnerId: result.currentPartnerId,
      ...(result.currentPartnerPlayerId !== undefined && {
        currentPartnerPlayerId: result.currentPartnerPlayerId,
      }),
      ...(result.partners !== undefined && {
        partners: result.partners,
      }),
      ...(result.currentLetterSelectedAt !== undefined && {
        currentLetterSelectedAt: result.currentLetterSelectedAt,
      }),
    };
  }

  @Delete(':key')
  async deleteBoard(@Param('key') key: string, @Headers('x-board-pin') pinHeader?: string) {
    return pinHeader
      ? this.alphadateService.deleteBoard(key, pinHeader)
      : this.alphadateService.deleteBoard(key);
  }
}
