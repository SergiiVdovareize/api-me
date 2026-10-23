-- CreateTable
CREATE TABLE "human_assist_sync" (
    "user_id" VARCHAR(64) NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "human_assist_sync_pkey" PRIMARY KEY ("user_id")
);
