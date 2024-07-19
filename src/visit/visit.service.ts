import { Injectable} from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import { CreateVisitDto } from './dto/create-visit.dto';
// import { UpdateMenuDto } from './dto/update-menu.dto';
// import { Visit } from './visit.entity';
import { PrismaService } from 'src/prisma.service';
import { Visit, Prisma } from '@prisma/client';

@Injectable()
export class VisitService {
    constructor(private prisma: PrismaService) {}

    // async findAll(): Promise<Visit[]> {
    //     return await this.visitRepository.find();
    // }
    
    async visits(params: {
        skip?: number;
        take?: number;
        cursor?: Prisma.VisitWhereUniqueInput;
        where?: Prisma.VisitWhereInput;
        orderBy?: Prisma.VisitOrderByWithRelationInput;
      }): Promise<Visit[]> {
        const { skip, take, cursor, where, orderBy } = params;
        return this.prisma.visit.findMany({
          skip,
          take,
          cursor,
          where,
          orderBy,
        });
      }
    // async count(): Promise<number> {
    //     return await this.visitRepository.count();
    // }

    // async countType(apiType: number): Promise<number> {
    //     return await this.visitRepository.count({ where: { apiType }});
    // }

    async add(apiType: number): Promise<Visit> {
      return this.prisma.visit.create({
        data: {
          apiType,
        }
      })
        // const createMenuDto = new CreateVisitDto()
        // createMenuDto.apiType = 0
        // createMenuDto.timestamp = Date.now();
        // const visit = this.visitRepository.create(createMenuDto);
        // return await this.visitRepository.save(visit);
      }
  }