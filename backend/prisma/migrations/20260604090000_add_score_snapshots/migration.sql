-- CreateTable
CREATE TABLE "PortfolioScore" (
    "id" BIGSERIAL NOT NULL,
    "positionId" BIGINT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "momentum" DOUBLE PRECISION NOT NULL,
    "trendScore" DOUBLE PRECISION NOT NULL,
    "profitScore" DOUBLE PRECISION NOT NULL,
    "volumeScore" DOUBLE PRECISION NOT NULL,
    "tradeScore" DOUBLE PRECISION NOT NULL,
    "inTrailingMode" BOOLEAN NOT NULL,
    "makingNewExtremes" BOOLEAN NOT NULL,
    "protected" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortfolioScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateScore" (
    "id" BIGSERIAL NOT NULL,
    "symbol" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "momentumScore" DOUBLE PRECISION NOT NULL,
    "trendScore" DOUBLE PRECISION NOT NULL,
    "volumeScore" DOUBLE PRECISION NOT NULL,
    "breakoutScore" DOUBLE PRECISION NOT NULL,
    "candleScore" DOUBLE PRECISION NOT NULL,
    "liquidityScore" DOUBLE PRECISION NOT NULL,
    "volumeRatio" DOUBLE PRECISION NOT NULL,
    "quoteVolume24h" DOUBLE PRECISION NOT NULL,
    "openInterest" DOUBLE PRECISION NOT NULL,
    "openInterestNotional" DOUBLE PRECISION NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "reasons" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PortfolioScore_positionId_createdAt_idx" ON "PortfolioScore"("positionId", "createdAt");

-- CreateIndex
CREATE INDEX "PortfolioScore_symbol_createdAt_idx" ON "PortfolioScore"("symbol", "createdAt");

-- CreateIndex
CREATE INDEX "CandidateScore_symbol_createdAt_idx" ON "CandidateScore"("symbol", "createdAt");

-- CreateIndex
CREATE INDEX "CandidateScore_score_createdAt_idx" ON "CandidateScore"("score", "createdAt");
