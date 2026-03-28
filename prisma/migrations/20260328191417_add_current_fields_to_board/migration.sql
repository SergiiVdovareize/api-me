-- AlterTable
ALTER TABLE "AlphadateBoard" ADD COLUMN     "currentLetter" CHAR(1),
ADD COLUMN     "currentPartnerId" INTEGER;

-- AddForeignKey
ALTER TABLE "AlphadateBoard" ADD CONSTRAINT "AlphadateBoard_currentPartnerId_fkey" FOREIGN KEY ("currentPartnerId") REFERENCES "AlphadatePartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
