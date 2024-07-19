import {
  Controller,
  Get,
} from '@nestjs/common';
import { RequestsService } from './requests.service';
// import { CreateArticleDto } from './dto/create-article.dto';

@Controller('requests')
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  // @Post()
  // create(@Body() createArticleDto: CreateArticleDto) {
  //   return this.requestsService.create(createArticleDto);
  // }

  @Get()
  findAll() {
    return this.requestsService.findAll();
  }
}
