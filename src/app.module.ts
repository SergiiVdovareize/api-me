import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { RequestsModule } from './requests/requests.module';
import { RequestsService } from './requests/requests.service';
import { CloudsModule } from './clouds/clouds.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule.forRoot(), PrismaModule, RequestsModule, CloudsModule],
  controllers: [AppController],
  providers: [AppService, RequestsService],
})
export class AppModule {}
