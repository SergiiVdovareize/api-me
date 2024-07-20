import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateRequestDto } from './dto/create-request.dto';

@Injectable()
export class RequestsService {
  constructor(private prisma: PrismaService) {}

  getDateMonthAgo(): Date {
    var today = new Date();
    var priorDate = new Date(new Date().setDate(today.getDate() - 30));
    return priorDate;
  }

  registerPlainApiCall() {
    return this.registerApiCall(0)
  }
  
  registerFibonacciApiCall() {
    return this.registerApiCall(1)
  }

  registerPrimeApiCall() {
    return this.registerApiCall(2)
  }

  registerArmstrongApiCall() {
    return this.registerApiCall(3)
  }

  registerApiCall(apiType: number) {
    const createRequestDto = new CreateRequestDto();
    createRequestDto.apiType = apiType;
    return this.create(createRequestDto)
  }

  create(createRequestDto: CreateRequestDto) {
    return this.prisma.request.create({ data: createRequestDto });
  }

  // findAll() {
  //   return this.prisma.request.findMany({
  //     orderBy: [
  //       { id: 'desc', }
  //     ]
  //   });
  // }

  countAll(): Promise<number> {
    return this.prisma.request.count();
  }

  countType(apiType: number): Promise<number> {
    return this.prisma.request.count({
      where: {
        apiType
      }
    });
  }
  
  countAllThisMonth(): Promise<number> {
    return this.prisma.request.count({
      where: {
        createdAt: {
          gte: this.getDateMonthAgo()
        }
      }
    });
  }

  countTypeThisMonth(apiType: number): Promise<number> {
    return this.prisma.request.count({
      where: {
        apiType,
        createdAt: {
          gte: this.getDateMonthAgo()
        }
      }
    });
  }
}
