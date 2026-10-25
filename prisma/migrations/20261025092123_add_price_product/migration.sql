-- CreateEnum
CREATE TYPE "PriceProductStatus" AS ENUM ('ACTIVE', 'UNSUPPORTED', 'ERROR');

-- CreateTable
CREATE TABLE "PriceProduct" (
    "id" SERIAL NOT NULL,
    "url" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "lastPrice" DOUBLE PRECISION,
    "currency" VARCHAR(10) NOT NULL DEFAULT 'UAH',
    "inStock" BOOLEAN NOT NULL DEFAULT true,
    "status" "PriceProductStatus" NOT NULL DEFAULT 'ACTIVE',
    "targetPrice" DOUBLE PRECISION,
    "dropPercent" DOUBLE PRECISION,
    "notifyOnRestock" BOOLEAN NOT NULL DEFAULT false,
    "lastNotifiedPrice" DOUBLE PRECISION,
    "chatId" VARCHAR(64) DEFAULT '1252877',
    "selector" TEXT,
    "sizes" JSONB,
    "colors" JSONB,
    "desiredSize" VARCHAR(32),
    "desiredColor" VARCHAR(64),
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "history" JSONB DEFAULT '[]',
    "lastCheckedAt" TIMESTAMP(3),
    "nextCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PriceProduct_url_key" ON "PriceProduct"("url");

-- CreateIndex
CREATE INDEX "PriceProduct_status_nextCheckAt_idx" ON "PriceProduct"("status", "nextCheckAt");

-- CreateIndex
CREATE INDEX "PriceProduct_domain_idx" ON "PriceProduct"("domain");
