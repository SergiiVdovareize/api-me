/*
  Warnings:

  - You are about to drop the column `state` on the `AlphadateBoard` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "AlphadateBoard" DROP COLUMN "state",
ADD COLUMN     "settings" JSONB DEFAULT '{}';

-- CreateTable
CREATE TABLE "AlphadatePartner" (
    "id" SERIAL NOT NULL,
    "boardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "turnOrder" SMALLINT NOT NULL,

    CONSTRAINT "AlphadatePartner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AlphadatePartner_boardId_turnOrder_key" ON "AlphadatePartner"("boardId", "turnOrder");

-- AddForeignKey
ALTER TABLE "AlphadatePartner" ADD CONSTRAINT "AlphadatePartner_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "AlphadateBoard"("key") ON DELETE CASCADE ON UPDATE CASCADE;
