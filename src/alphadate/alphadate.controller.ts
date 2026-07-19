import {
  Controller,
  Post,
  Body,
  Get,
  Put,
  Delete,
  Param,
  BadRequestException,
} from '@nestjs/common';
import { AlphadateService } from './alphadate.service';
import { CreateBoardDto } from './dto/create-board.dto';

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

  @Get(':key')
  async getBoardState(@Param('key') key: string) {
    return this.alphadateService.getBoardState(key);
  }

  @Put(':key')
  async updateBoardState(@Param('key') key: string, @Body() body: any) {
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
    }

    let parsedPartners: string[] | undefined = undefined;
    let parsedPinHash: string | null | undefined = undefined;

    if (metadata !== undefined && metadata !== null) {
      if (typeof metadata !== 'object' || Array.isArray(metadata)) {
        throw new BadRequestException('metadata must be a JSON object');
      }

      const { partners, pinHash } = metadata;

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

      if (pinHash !== undefined) {
        if (pinHash !== null && typeof pinHash !== 'string') {
          throw new BadRequestException('metadata.pinHash must be a string or null');
        }
        parsedPinHash = pinHash;
      }
    }

    const updateBoardDto: any = {
      letters: letters.map(item => ({
        letter: item.letter.trim(),
        status: item.status,
      })),
    };

    if (currentLetter !== undefined) {
      updateBoardDto.currentLetter = currentLetter;
    }

    if (parsedPartners !== undefined || parsedPinHash !== undefined) {
      updateBoardDto.metadata = {};
      if (parsedPartners !== undefined) {
        updateBoardDto.metadata.partners = parsedPartners;
      }
      if (parsedPinHash !== undefined) {
        updateBoardDto.metadata.pinHash = parsedPinHash;
      }
    }

    const result = await this.alphadateService.updateBoardState(key, updateBoardDto);

    return {
      success: true,
      currentPartnerId: result.currentPartnerId,
    };
  }

  @Delete(':key')
  async deleteBoard(@Param('key') key: string) {
    return this.alphadateService.deleteBoard(key);
  }
}
