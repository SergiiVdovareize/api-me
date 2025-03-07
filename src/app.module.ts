import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
// import { SentryModule } from '@sentry/nestjs/setup';
// import { APP_FILTER } from '@nestjs/core';
// import { SentryGlobalFilter } from '@sentry/nestjs/setup';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { RequestsModule } from './requests/requests.module';
import { RequestsService } from './requests/requests.service';
import { CloudsModule } from './clouds/clouds.module';
import { ConfigModule } from '@nestjs/config';
import { LoggerMiddleware } from './common/middleware/logger.middleware';
import { CloudsController } from './clouds/clouds.controller';
import { MemesModule } from './memes/memes.module';
import { AsyncModule } from './async/async.module';
import { AnalyticsService } from './analytics/analytics.service';
import { PosthogService } from './posthog/posthog.service';
import { TrackModule } from './track/track.module';
import { ScheduleModule } from '@nestjs/schedule';
import { TasksService } from './task/task.service';

@Module({
  imports: [
    // SentryModule.forRoot(),
    ConfigModule.forRoot(),
    ScheduleModule.forRoot(),
    PrismaModule,
    RequestsModule,
    CloudsModule,
    MemesModule,
    AsyncModule,
    TrackModule,
  ],
  controllers: [AppController],
  providers: [
    // {
    //   provide: APP_FILTER,
    //   useClass: SentryGlobalFilter,
    // },
    AppService,
    RequestsService,
    PosthogService,
    AnalyticsService,
    TasksService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes(CloudsController);
  }
}
