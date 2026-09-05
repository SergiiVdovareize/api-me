import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SeriesTrackerController } from './series-tracker.controller';
import { SeriesTrackerService } from './series-tracker.service';
import { GoogleSheetsService } from './services/google-sheets.service';
import { UakinoParserService } from './services/uakino-parser.service';

@Module({
  imports: [ConfigModule],
  controllers: [SeriesTrackerController],
  providers: [SeriesTrackerService, GoogleSheetsService, UakinoParserService],
  exports: [SeriesTrackerService],
})
export class SeriesTrackerModule {}
