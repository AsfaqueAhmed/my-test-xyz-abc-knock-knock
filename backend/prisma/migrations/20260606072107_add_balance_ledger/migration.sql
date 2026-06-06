-- CreateTable
CREATE TABLE "BalanceLedger" (
    "id" BIGSERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "balanceAfter" DOUBLE PRECISION NOT NULL,
    "symbol" TEXT,
    "positionId" BIGINT,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BalanceLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BalanceLedger_createdAt_idx" ON "BalanceLedger"("createdAt");

-- CreateIndex
CREATE INDEX "BalanceLedger_type_createdAt_idx" ON "BalanceLedger"("type", "createdAt");

-- CreateIndex
CREATE INDEX "BalanceLedger_positionId_idx" ON "BalanceLedger"("positionId");
