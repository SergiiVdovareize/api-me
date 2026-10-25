import { existsSync } from 'fs';
import * as dotenv from 'dotenv';
import { PrismaClient, PriceProductStatus } from '@prisma/client';
import { SafeFetchService } from '../src/prices/fetcher/safe-fetch.service';
import { JsonLdExtractor } from '../src/prices/extractors/json-ld.extractor';
import { MetaExtractor } from '../src/prices/extractors/meta.extractor';

async function main() {
  const args = process.argv.slice(2);
  const isProd = args.includes('--prod') || args.includes('--production') || true;
  const envPath = isProd && existsSync('.env.production.local') ? '.env.production.local' : '.env';

  dotenv.config({ path: envPath, override: true });

  const url = args.find(a => a.startsWith('http://') || a.startsWith('https://'));
  if (!url) {
    console.error('Usage: npm run prices:add -- <url> [--target <price>] [--drop <percent>]');
    process.exit(1);
  }

  const targetIndex = args.indexOf('--target');
  const targetPrice = targetIndex !== -1 && args[targetIndex + 1] ? parseFloat(args[targetIndex + 1]) : null;

  const dropIndex = args.indexOf('--drop');
  const dropPercent = dropIndex !== -1 && args[dropIndex + 1] ? parseFloat(args[dropIndex + 1]) : null;

  console.log(`Adding product to price tracking: ${url}`);

  const fetcher = new SafeFetchService();
  const jsonLd = new JsonLdExtractor();
  const meta = new MetaExtractor();

  console.log('Fetching and analyzing product page...');
  const html = await fetcher.fetchHtml(url);

  const extracted = (await jsonLd.extract(html)) || (await meta.extract(html));
  if (!extracted || !extracted.price) {
    console.error('❌ Could not extract price from URL.');
    process.exit(1);
  }

  console.log(`✅ Extracted data:`);
  console.log(`   Title:    ${extracted.title}`);
  console.log(`   Price:    ${extracted.price} ${extracted.currency || 'UAH'}`);
  console.log(`   In Stock: ${extracted.inStock}`);

  const prisma = new PrismaClient();
  try {
    const domain = new URL(url).hostname;
    const now = new Date();
    const nextCheckAt = new Date(now.getTime() + 6 * 60 * 60 * 1000);

    const existing = await prisma.priceProduct.findUnique({ where: { url } });
    if (existing) {
      const updated = await prisma.priceProduct.update({
        where: { id: existing.id },
        data: {
          lastPrice: extracted.price,
          inStock: extracted.inStock,
          targetPrice: targetPrice ?? existing.targetPrice,
          dropPercent: dropPercent ?? existing.dropPercent,
          status: PriceProductStatus.ACTIVE,
          failCount: 0,
          lastCheckedAt: now,
          nextCheckAt,
        },
      });
      console.log(`✅ Updated existing product #${updated.id} in database.`);
    } else {
      const created = await prisma.priceProduct.create({
        data: {
          url,
          domain,
          title: extracted.title || domain,
          lastPrice: extracted.price,
          currency: extracted.currency || 'UAH',
          inStock: extracted.inStock,
          targetPrice,
          dropPercent,
          status: PriceProductStatus.ACTIVE,
          chatId: '1252877',
          failCount: 0,
          history: [{ price: extracted.price, inStock: extracted.inStock, checkedAt: now.toISOString() }],
          lastCheckedAt: now,
          nextCheckAt,
        },
      });
      console.log(`✅ Added new product #${created.id} to price tracking database!`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
