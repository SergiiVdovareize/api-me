import { Controller, Get } from '@nestjs/common';
import { VisitService } from './visit.service';
// import { Visit } from './visit.entity';
import { Visit as VisitModel } from '@prisma/client';

@Controller('visit') // Define the base route for this controller
export class VisitController {
  constructor(private readonly visitService: VisitService) {}

  @Get() // requests to retrieve all menus
  findAll(): Promise<VisitModel[]> {
    console.log('** GET')
    // this.visitService.add();
    return this.visitService.visits({});
  }

  @Get('feed')
  async getAllVisits(): Promise<VisitModel[]> {
    console.log('** feed')
    return this.visitService.visits({});
  }

  // @Get('count') // requests to retrieve all menus
  // countAll(): Promise<number> {
  //   return this.visitService.count();
  // }

  // @Get('count/:apiType') // requests to retrieve all menus
  // countType(@Param('apiType') apiType: number): Promise<number> {
  //   return this.visitService.countType(apiType);
  // }
}