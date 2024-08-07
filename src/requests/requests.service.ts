import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateRequestDto } from './dto/create-request.dto';

const API_TYPE = {
  PLAIN: 0,
  AMAZON: 1,
  GOOGLE: 2,
  AZURE: 3,
}

const CLOUD_MAP = {
  PLAIN: API_TYPE.PLAIN,
  FIBONACCI: API_TYPE.AMAZON,
  PRIME: API_TYPE.GOOGLE,
  ARMSTRONG: API_TYPE.AZURE,
}

@Injectable()
export class RequestsService {
  constructor(private prisma: PrismaService) {}

  getDateMonthAgo(): Date {
    var today = new Date();
    var priorDate = new Date(new Date().setDate(today.getDate() - 31));
    return priorDate;
  }

  registerPlainApiCall() {
    return this.registerApiCall(CLOUD_MAP.PLAIN)
  }
  
  registerFibonacciApiCall() {
    return this.registerApiCall(CLOUD_MAP.FIBONACCI)
  }

  registerPrimeApiCall() {
    return this.registerApiCall(CLOUD_MAP.PRIME)
  }

  registerArmstrongApiCall() {
    return this.registerApiCall(CLOUD_MAP.ARMSTRONG)
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

  countFibonacciThisMonth(): Promise<number> {
    return this.countTypeThisMonth(CLOUD_MAP.FIBONACCI);
  }

  countPrimeThisMonth(): Promise<number> {
    return this.countTypeThisMonth(CLOUD_MAP.PRIME);
  }

  countArmstrongThisMonth(): Promise<number> {
    return this.countTypeThisMonth(CLOUD_MAP.ARMSTRONG);
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
