-- CreateTable
CREATE TABLE "Visit" (
    "id" SERIAL NOT NULL,
    "apiType" INTEGER NOT NULL,
    "timestamp" INTEGER NOT NULL,

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);
