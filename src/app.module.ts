import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
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

@Module({
  imports: [ConfigModule.forRoot(), PrismaModule, RequestsModule, CloudsModule, MemesModule],
  controllers: [AppController],
  providers: [AppService, RequestsService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes(CloudsController);
  }
}
