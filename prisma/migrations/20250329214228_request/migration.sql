-- CreateTable
CREATE TABLE "Request" (
    "id" SERIAL NOT NULL,
    "apiType" INTEGER NOT NULL,
    "temp" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Request_pkey" PRIMARY KEY ("id")
);
