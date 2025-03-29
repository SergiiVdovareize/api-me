-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('mono', 'privat');

-- CreateTable
CREATE TABLE "Account" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "trackId" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "title" TEXT,
    "description" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountIncoming" (
    "id" SERIAL NOT NULL,
    "balance" INTEGER NOT NULL,
    "trackedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accountId" INTEGER NOT NULL,

    CONSTRAINT "AccountIncoming_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_trackId_key" ON "Account"("trackId");

-- AddForeignKey
ALTER TABLE "AccountIncoming" ADD CONSTRAINT "AccountIncoming_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
