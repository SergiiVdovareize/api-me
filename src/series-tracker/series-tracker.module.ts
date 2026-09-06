import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SeriesTrackerService } from './series-tracker.service';
import { GoogleSheetsService } from './services/google-sheets.service';
import { UakinoParserService } from './services/uakino-parser.service';

@Module({
  imports: [ConfigModule],
  providers: [SeriesTrackerService, GoogleSheetsService, UakinoParserService],
  exports: [SeriesTrackerService, GoogleSheetsService, UakinoParserService],
})
export class SeriesTrackerModule {}
