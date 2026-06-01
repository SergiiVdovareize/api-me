import { Test, TestingModule } from '@nestjs/testing';
import { TrackService } from './track.service';

import { PrismaService } from 'src/prisma.service';
import { AnalyticsService } from 'src/analytics/analytics.service';
import { RedisReader } from 'src/common/helpers/redisReader';

describe('TrackService', () => {
  let service: TrackService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TrackService,
        {
          provide: PrismaService,
          useValue: {},
        },
        {
          provide: AnalyticsService,
          useValue: {},
        },
        {
          provide: RedisReader,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<TrackService>(TrackService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
