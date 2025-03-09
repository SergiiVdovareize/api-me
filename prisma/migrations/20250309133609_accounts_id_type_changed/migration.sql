/*
  Warnings:

  - The primary key for the `Account` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `id` column on the `Account` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `AccountIncoming` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `id` column on the `AccountIncoming` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Changed the type of `accountId` on the `AccountIncoming` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- DropForeignKey
ALTER TABLE "AccountIncoming" DROP CONSTRAINT "AccountIncoming_accountId_fkey";

-- AlterTable
ALTER TABLE "Account" DROP CONSTRAINT "Account_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
ADD CONSTRAINT "Account_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "AccountIncoming" DROP CONSTRAINT "AccountIncoming_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
DROP COLUMN "accountId",
ADD COLUMN     "accountId" INTEGER NOT NULL,
ADD CONSTRAINT "AccountIncoming_pkey" PRIMARY KEY ("id");

-- AddForeignKey
ALTER TABLE "AccountIncoming" ADD CONSTRAINT "AccountIncoming_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
