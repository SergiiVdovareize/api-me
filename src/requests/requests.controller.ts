import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { RequestsService } from './requests.service';
// import { CreateArticleDto } from './dto/create-article.dto';

@Controller('requests')
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  // @Post()
  // create(@Body() createArticleDto: CreateArticleDto) {
  //   return this.requestsService.create(createArticleDto);
  // }

  // @Get()
  // findAll() {
  //   return this.requestsService.findAll();
  // }

  @Get('/count')
  count() {
    return this.requestsService.countAll();
  }

  @Get('/count/month')
  countThisMonth() {
    return this.requestsService.countAllThisMonth();
  }

  @Get('/count/:apiType')
  countType(@Param('apiType', ParseIntPipe) apiType: number) {
    return this.requestsService.countType(apiType);
  }

  @Get('/count/month/:apiType')
  countTypeThisMonth(@Param('apiType', ParseIntPipe) apiType: number) {
    return this.requestsService.countTypeThisMonth(apiType);
  }
}
