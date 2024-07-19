import { Module } from '@nestjs/common';
import { VisitService } from './visit.service';
import { VisitController } from './visit.controller';
// import { TypeOrmModule } from '@nestjs/typeorm';
// import { Visit } from './visit.entity';

@Module({
  // imports: [TypeOrmModule.forFeature([Visit])],
  providers: [VisitService],
  controllers: [VisitController]
})
export class VisitModule {}
