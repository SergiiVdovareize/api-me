-- Drop legacy table if exists
DROP TABLE IF EXISTS "CatcastKey";

-- CreateTable
CREATE TABLE IF NOT EXISTS "CatcastDevice" (
    "id" SERIAL NOT NULL,
    "deviceId" VARCHAR(128) NOT NULL,
    "platform" VARCHAR(32) NOT NULL,
    "model" VARCHAR(128),
    "os" VARCHAR(128),
    "isAllowed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatcastDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CatcastDevice_deviceId_key" ON "CatcastDevice"("deviceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CatcastDevice_deviceId_isAllowed_idx" ON "CatcastDevice"("deviceId", "isAllowed");

-- CreateTable
CREATE TABLE IF NOT EXISTS "CatcastDeviceRequest" (
    "id" VARCHAR(64) NOT NULL,
    "deviceId" VARCHAR(128) NOT NULL,
    "platform" VARCHAR(32) NOT NULL,
    "model" VARCHAR(128),
    "os" VARCHAR(128),
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "telegramMessageId" INTEGER,
    "telegramChatId" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatcastDeviceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CatcastDeviceRequest_deviceId_createdAt_idx" ON "CatcastDeviceRequest"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CatcastDeviceRequest_deviceId_status_idx" ON "CatcastDeviceRequest"("deviceId", "status");
