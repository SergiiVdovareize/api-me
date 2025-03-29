/*
  Warnings:

  - You are about to drop the `Account` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `AccountIncoming` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "AccountIncoming" DROP CONSTRAINT "AccountIncoming_accountId_fkey";

-- DropTable
DROP TABLE "Account";

-- DropTable
DROP TABLE "AccountIncoming";
