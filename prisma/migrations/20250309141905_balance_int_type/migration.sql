/*
  Warnings:

  - You are about to alter the column `balance` on the `AccountIncoming` table. The data in that column could be lost. The data in that column will be cast from `Decimal(65,30)` to `Integer`.

*/
-- AlterTable
ALTER TABLE "AccountIncoming" ALTER COLUMN "balance" SET DATA TYPE INTEGER;
