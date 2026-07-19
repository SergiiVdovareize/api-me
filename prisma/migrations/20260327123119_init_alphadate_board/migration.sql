-- CreateTable
CREATE TABLE "AlphadateBoard" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT,
    "pin" TEXT,
    "state" JSONB DEFAULT '{}',

    CONSTRAINT "AlphadateBoard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AlphadateBoard_key_key" ON "AlphadateBoard"("key");
