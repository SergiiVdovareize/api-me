import { existsSync } from 'fs';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { Logger } from '@nestjs/common';
import { GenderizeService } from '../src/alphadate/genderize.service';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
  const args = process.argv.slice(2);
  const isProd = args.includes('--prod') || args.includes('--production');
  const envIndex = args.indexOf('--env');
  const envPath =
    envIndex !== -1 && args[envIndex + 1]
      ? args[envIndex + 1]
      : isProd
        ? '.env.production.local'
        : '.env';

  if (existsSync(envPath)) {
    dotenv.config({ path: envPath, override: true });
  } else {
    dotenv.config();
  }

  const logger = new Logger('BackfillPartnerPlayerIds');
  const prisma = new PrismaClient();
  const genderizeService = new GenderizeService();

  const overwriteAll = args.includes('--all');
  const dbUrl = process.env.POSTGRES_PRISMA_URL || process.env.DATABASE_URL || '';
  const maskedDbUrl = dbUrl.replace(/:[^:@]+@/, ':***@');

  logger.log(
    `Starting partner playerId backfill script via Genderize.io (env: ${fs.existsSync(envPath) ? envPath : 'environment variables'}, db: ${maskedDbUrl || 'default'}, mode: ${overwriteAll ? 'overwrite all' : 'only missing playerIds'})...`
  );

  try {
    const boards = await prisma.alphadateBoard.findMany({
      include: {
        partners: {
          orderBy: { turnOrder: 'asc' },
        },
      },
    });

    logger.log(`Found ${boards.length} total boards to inspect.`);

    let updatedBoardsCount = 0;
    let updatedPartnersCount = 0;

    for (const board of boards) {
      if (!board.partners || board.partners.length === 0) {
        continue;
      }

      const hasMissingPlayerId = board.partners.some(p => p.playerId === null || p.playerId === undefined);
      if (!overwriteAll && !hasMissingPlayerId) {
        continue;
      }

      const partnerNames = board.partners.map(p => p.name);
      const genders = await genderizeService.detectGenders(partnerNames);
      const playerIds = genderizeService.assignPlayerIds(genders);

      logger.log(
        `Board [${board.key}]: ${partnerNames.map((n, i) => `${n} (${genders[i] || 'null'} -> ID:${playerIds[i] ?? 'null'})`).join(', ')}`
      );

      for (let i = 0; i < board.partners.length; i++) {
        await prisma.alphadatePartner.update({
          where: { id: board.partners[i].id },
          data: {
            playerId: playerIds[i],
          },
        });
        updatedPartnersCount++;
      }

      updatedBoardsCount++;

      // Pause briefly between boards to respect Genderize.io API rate limits
      await delay(250);
    }

    logger.log(
      `Backfill completed successfully! Processed ${updatedBoardsCount} boards, updated ${updatedPartnersCount} partners.`
    );
  } catch (error: any) {
    logger.error(`Failed to backfill partner player IDs: ${error.message}`, error.stack);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

run();
