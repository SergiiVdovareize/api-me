import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateRequestDto } from './dto/create-request.dto';
import { AnalyticsService } from 'src/analytics/analytics.service';

const API_TYPE = {
  PLAIN: 0,
  AMAZON: 1,
  GOOGLE: 2,
  AZURE: 3,
  MEME_INST: 10,
  MEME_TWI: 11,
  MEME_YOU: 12,
  MEME_FACE: 13,
  MEME_TIK: 14,
  MEME_LIN: 15,
  MEME_UNK: 39,
};

const CLOUD_MAP = {
  PLAIN: API_TYPE.PLAIN,
  FIBONACCI: API_TYPE.AMAZON,
  PRIME: API_TYPE.GOOGLE,
  ARMSTRONG: API_TYPE.AZURE,
};

const MEME_MAP = {
  [API_TYPE.MEME_YOU]: ['youtube.com', 'youtu.be'],
  [API_TYPE.MEME_TWI]: ['x.com', 'twitter.com'],
  [API_TYPE.MEME_INST]: ['instagram.com'],
  [API_TYPE.MEME_FACE]: ['facebook.com'],
  [API_TYPE.MEME_TIK]: ['tiktok.com'],
  [API_TYPE.MEME_LIN]: ['linkedin.com'],
};

@Injectable()
export class RequestsService {
  constructor(
    private prisma: PrismaService,
    private analyticsService: AnalyticsService,
  ) {}

  getDateMonthAgo(): Date {
    const today = new Date();
    const priorDate = new Date(new Date().setDate(today.getDate() - 31));
    return priorDate;
  }

  registerPlainApiCall() {
    return this.registerApiCall(CLOUD_MAP.PLAIN);
  }

  registerFibonacciApiCall() {
    return this.registerApiCall(CLOUD_MAP.FIBONACCI);
  }

  registerPrimeApiCall() {
    return this.registerApiCall(CLOUD_MAP.PRIME);
  }

  registerArmstrongApiCall() {
    return this.registerApiCall(CLOUD_MAP.ARMSTRONG);
  }

  registerMemeApiCall(url: string, extraData?: {}) {
    const domainKey =
      Object.keys(MEME_MAP).find((key) =>
        MEME_MAP[key].some((domain: string) => url.includes(domain)),
      ) || API_TYPE.MEME_UNK;

    return this.registerApiCall(Number(domainKey), extraData);
  }

  registerApiCall(apiType: number, extraData?: {}) {
    this.analyticsService.trackEvent('ApiCall', {
      apiType,
      ...extraData,
    });

    const createRequestDto = new CreateRequestDto();
    createRequestDto.apiType = apiType;
    return this.create(createRequestDto);
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
        apiType,
      },
    });
  }

  countAllThisMonth(): Promise<number> {
    return this.prisma.request.count({
      where: {
        createdAt: {
          gte: this.getDateMonthAgo(),
        },
      },
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
          gte: this.getDateMonthAgo(),
        },
      },
    });
  }
}
