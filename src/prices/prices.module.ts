import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../models/prisma/prisma.module';
import { RedisModule } from '../common/redis.module';
import { LlmModule } from '../llm/llm.module';
import { SeriesTrackerModule } from '../series-tracker/series-tracker.module';
import { PricesController } from './prices.controller';
import { ProductsController } from './products.controller';
import { PricesService } from './prices.service';
import { SafeFetchService } from './fetcher/safe-fetch.service';
import { JsonLdExtractor } from './extractors/json-ld.extractor';
import { MetaExtractor } from './extractors/meta.extractor';
import { RecipeExtractor } from './extractors/recipe.extractor';
import { AiExtractor } from './extractors/ai.extractor';
import { NotificationService } from './notification.service';

@Module({
  imports: [ConfigModule, PrismaModule, RedisModule, LlmModule, SeriesTrackerModule],
  controllers: [PricesController, ProductsController],
  providers: [
    PricesService,
    SafeFetchService,
    JsonLdExtractor,
    MetaExtractor,
    RecipeExtractor,
    AiExtractor,
    NotificationService,
  ],
  exports: [PricesService],
})
export class PricesModule {}
