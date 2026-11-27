/*
  Warnings:

  - A unique constraint covering the columns `[syncTokenHash]` on the table `CatcastDevice` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "CatcastDevice" ADD COLUMN     "browser" VARCHAR(80),
ADD COLUMN     "deviceName" VARCHAR(120),
ADD COLUMN     "profileId" VARCHAR(64),
ADD COLUMN     "syncLastSeenAt" TIMESTAMP(3),
ADD COLUMN     "syncTokenHash" VARCHAR(64);

-- CreateTable
CREATE TABLE "CatcastProfile" (
    "id" VARCHAR(64) NOT NULL,
    "historyClearedTs" BIGINT NOT NULL DEFAULT 0,
    "searchQueries" JSONB NOT NULL DEFAULT '[]',
    "searchUpdatedAt" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatcastProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatcastSyncHistory" (
    "id" SERIAL NOT NULL,
    "profileId" VARCHAR(64) NOT NULL,
    "mediaKey" VARCHAR(256) NOT NULL,
    "url" VARCHAR(512) NOT NULL DEFAULT '',
    "canonicalId" VARCHAR(128) NOT NULL DEFAULT '',
    "title" VARCHAR(512) NOT NULL DEFAULT '',
    "orig" VARCHAR(512) NOT NULL DEFAULT '',
    "poster" VARCHAR(1024) NOT NULL DEFAULT '',
    "season" INTEGER,
    "episode" INTEGER,
    "episodeName" VARCHAR(256) NOT NULL DEFAULT '',
    "currentTime" INTEGER NOT NULL DEFAULT 0,
    "duration" INTEGER NOT NULL DEFAULT 0,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "watchedEpisodes" JSONB NOT NULL DEFAULT '{}',
    "voice" VARCHAR(256) NOT NULL DEFAULT '',
    "ts" BIGINT NOT NULL,
    "updatedOnServerAt" BIGINT NOT NULL,

    CONSTRAINT "CatcastSyncHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatcastSyncFavorite" (
    "id" SERIAL NOT NULL,
    "profileId" VARCHAR(64) NOT NULL,
    "mediaKey" VARCHAR(256) NOT NULL,
    "url" VARCHAR(512) NOT NULL DEFAULT '',
    "canonicalId" VARCHAR(128) NOT NULL DEFAULT '',
    "title" VARCHAR(512) NOT NULL DEFAULT '',
    "orig" VARCHAR(512) NOT NULL DEFAULT '',
    "poster" VARCHAR(1024) NOT NULL DEFAULT '',
    "ts" BIGINT NOT NULL,
    "deletedAt" BIGINT,
    "updatedOnServerAt" BIGINT NOT NULL,

    CONSTRAINT "CatcastSyncFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CatcastSyncHistory_profileId_updatedOnServerAt_idx" ON "CatcastSyncHistory"("profileId", "updatedOnServerAt");

-- CreateIndex
CREATE INDEX "CatcastSyncHistory_profileId_ts_idx" ON "CatcastSyncHistory"("profileId", "ts" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "CatcastSyncHistory_profileId_mediaKey_key" ON "CatcastSyncHistory"("profileId", "mediaKey");

-- CreateIndex
CREATE INDEX "CatcastSyncFavorite_profileId_updatedOnServerAt_idx" ON "CatcastSyncFavorite"("profileId", "updatedOnServerAt");

-- CreateIndex
CREATE UNIQUE INDEX "CatcastSyncFavorite_profileId_mediaKey_key" ON "CatcastSyncFavorite"("profileId", "mediaKey");

-- CreateIndex
CREATE UNIQUE INDEX "CatcastDevice_syncTokenHash_key" ON "CatcastDevice"("syncTokenHash");

-- CreateIndex
CREATE INDEX "CatcastDevice_profileId_idx" ON "CatcastDevice"("profileId");

-- AddForeignKey
ALTER TABLE "CatcastDevice" ADD CONSTRAINT "CatcastDevice_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CatcastProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatcastSyncHistory" ADD CONSTRAINT "CatcastSyncHistory_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CatcastProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatcastSyncFavorite" ADD CONSTRAINT "CatcastSyncFavorite_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CatcastProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
