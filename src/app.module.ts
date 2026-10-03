import { Module } from '@nestjs/common';
import { SentryModule } from '@sentry/nestjs/setup';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { SentryGlobalFilter } from '@sentry/nestjs/setup';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { DateController } from './date/date.controller';
import { AppService } from './app.service';
import { PrismaModule } from './models/prisma/prisma.module';
import { RequestsModule } from './requests/requests.module';
import { RequestsService } from './requests/requests.service';
import { CloudsModule } from './clouds/clouds.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MemesModule } from './memes/memes.module';
import { AsyncModule } from './async/async.module';
import { AnalyticsService } from './analytics/analytics.service';
import { PosthogService } from './posthog/posthog.service';
import { DateService } from './date/date.service';
import { TrackModule } from './track/track.module';
import { ScheduleModule } from '@nestjs/schedule';
import { CacheModule } from './cache/cache.module';
import { BlobService } from './blob/blob.service';
import { RedisReader } from './common/helpers/redisReader';
import { AnalyticsController } from './analytics/analytics.controller';
import { GameResultsModule } from './game-results/game-results.module';
import { AlphadateModule } from './alphadate/alphadate.module';
import { EmailModule } from './email/email.module';
import { SeriesTrackerModule } from './series-tracker/series-tracker.module';
import { FuelModule } from './fuel/fuel.module';
import { CnapModule } from './cnap/cnap.module';
import { LlmModule } from './llm/llm.module';

@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          name: 'default',
          ttl: 60000,
          limit: config.get('NODE_ENV') === 'test' || process.env.NODE_ENV === 'test' ? 1000 : 120,
        },
      ],
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    RequestsModule,
    CloudsModule,
    MemesModule,
    AsyncModule,
    TrackModule,
    CacheModule,
    GameResultsModule,
    AlphadateModule,
    EmailModule,
    SeriesTrackerModule,
    FuelModule,
    CnapModule,
    LlmModule,
  ],

  controllers: [AppController, DateController, AnalyticsController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    AppService,
    RequestsService,
    PosthogService,
    AnalyticsService,
    DateService,
    BlobService,
    RedisReader,
  ],
})
export class AppModule {}
