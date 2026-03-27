import { Controller, Post, Body } from '@nestjs/common';
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
}
