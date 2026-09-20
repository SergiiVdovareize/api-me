-- AlterTable
ALTER TABLE "AlphadateBoard" ADD COLUMN "currentLetterSelectedAt" TIMESTAMP(3);

-- Backfill currentLetterSelectedAt as now for existing boards with a selected letter to fill gaps
UPDATE "AlphadateBoard"
SET "currentLetterSelectedAt" = CURRENT_TIMESTAMP
WHERE "currentLetter" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "AlphadateHistory" DROP CONSTRAINT "AlphadateHistory_partnerId_fkey";

-- AlterTable
ALTER TABLE "AlphadateHistory" ALTER COLUMN "partnerId" DROP NOT NULL,
ADD COLUMN "completedAt" TIMESTAMP(3),
ADD COLUMN "note" TEXT,
ADD COLUMN "selectedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "AlphadateHistory" ADD CONSTRAINT "AlphadateHistory_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "AlphadatePartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
