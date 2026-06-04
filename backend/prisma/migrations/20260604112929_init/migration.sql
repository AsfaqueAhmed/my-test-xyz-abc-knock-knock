-- CreateTable
CREATE TABLE "BotLog" (
    "id" BIGSERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "symbol" TEXT,
    "message" TEXT NOT NULL,
    "metadata" TEXT,

    CONSTRAINT "BotLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BotLog_createdAt_idx" ON "BotLog"("createdAt");

-- CreateIndex
CREATE INDEX "BotLog_category_createdAt_idx" ON "BotLog"("category", "createdAt");

-- CreateIndex
CREATE INDEX "BotLog_symbol_createdAt_idx" ON "BotLog"("symbol", "createdAt");

-- CreateIndex
CREATE INDEX "BotLog_level_createdAt_idx" ON "BotLog"("level", "createdAt");
