import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateRequestDto } from './dto/create-request.dto';

@Injectable()
export class RequestsService {
  constructor(private prisma: PrismaService) {}

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

  findAll() {
    return this.prisma.request.findMany({
      orderBy: [
        { id: 'desc', }
      ]
    });
  }
}
