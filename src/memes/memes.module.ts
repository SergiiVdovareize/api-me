import { Module } from '@nestjs/common';
import { MemesController } from './memes.controller';
import { RequestsService } from 'src/requests/requests.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { MemesService } from './memes.service';

@Module({
  imports: [PrismaModule],
  controllers: [MemesController],
  providers: [MemesService, RequestsService],
})
export class MemesModule {}
