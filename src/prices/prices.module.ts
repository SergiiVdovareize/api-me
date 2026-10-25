import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../models/prisma/prisma.module';
import { RedisModule } from '../common/redis.module';
import { LlmModule } from '../llm/llm.module';
import { OutboxModule } from '../outbox/outbox.module';
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
  imports: [ConfigModule, PrismaModule, RedisModule, LlmModule, OutboxModule],
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
