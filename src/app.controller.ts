import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller()
export class AppController {
  constructor(private readonly prismaService: PrismaService) {}

  @Get()
  getHello(): Promise<number> {
    // console.log('** 1')
    // console.log('** createVisitDto', createVisitDto)
    // // this.visitService.create(createVisitDto)
    // console.log('** ')
    this.prismaService.visit.add(0);
    return this.prismaService.visit.count();
  }
}
