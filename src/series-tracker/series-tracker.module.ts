import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OutboxModule } from '../outbox/outbox.module';
import { SeriesTrackerService } from './series-tracker.service';
import { GoogleSheetsService } from './services/google-sheets.service';
import { UakinoParserService } from './services/uakino-parser.service';

@Module({
  imports: [ConfigModule, OutboxModule],
  providers: [SeriesTrackerService, GoogleSheetsService, UakinoParserService],
  exports: [SeriesTrackerService, GoogleSheetsService, UakinoParserService],
})
export class SeriesTrackerModule {}
