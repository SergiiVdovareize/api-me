import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { SeriesTrackerModule } from './series-tracker.module';
import { SeriesTrackerService } from './series-tracker.service';
import { GoogleSheetsService } from './services/google-sheets.service';
import { UakinoParserService } from './services/uakino-parser.service';

describe('SeriesTrackerModule', () => {
  it('should compile the module and resolve providers', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
        }),
        SeriesTrackerModule,
      ],
    }).compile();

    expect(module).toBeDefined();
    expect(module.get(SeriesTrackerService)).toBeDefined();
    expect(module.get(GoogleSheetsService)).toBeDefined();
    expect(module.get(UakinoParserService)).toBeDefined();
  });
});
