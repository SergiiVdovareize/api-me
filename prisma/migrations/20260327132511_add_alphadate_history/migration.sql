-- CreateEnum
CREATE TYPE "LetterStatus" AS ENUM ('used', 'skipped', 'excluded');

-- CreateTable
CREATE TABLE "AlphadateHistory" (
    "id" SERIAL NOT NULL,
    "boardId" TEXT NOT NULL,
    "partnerId" INTEGER NOT NULL,
    "letter" CHAR(1) NOT NULL,
    "status" "LetterStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlphadateHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AlphadateHistory_boardId_letter_key" ON "AlphadateHistory"("boardId", "letter");

-- AddForeignKey
ALTER TABLE "AlphadateHistory" ADD CONSTRAINT "AlphadateHistory_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "AlphadateBoard"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlphadateHistory" ADD CONSTRAINT "AlphadateHistory_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "AlphadatePartner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
