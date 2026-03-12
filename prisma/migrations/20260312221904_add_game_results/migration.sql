-- CreateEnum
CREATE TYPE "GameType" AS ENUM ('stroop');

-- CreateTable
CREATE TABLE "GameResult" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gameType" "GameType" NOT NULL,
    "name" TEXT NOT NULL,
    "result" INTEGER NOT NULL,

    CONSTRAINT "GameResult_pkey" PRIMARY KEY ("id")
);
