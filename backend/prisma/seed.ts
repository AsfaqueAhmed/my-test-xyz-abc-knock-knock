import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Seed default config
  const defaults = [
    { key: 'maxActivePositions', value: '5' },
    { key: 'maxEntriesPerSymbol', value: '3' },
    { key: 'maxCapitalPerEntry', value: '1000' },
    { key: 'initialBalance', value: '10000' },
    { key: 'leverage', value: '5' },
    { key: 'activationPct', value: '2' },
    { key: 'trailingPct', value: '3' },
    { key: 'hardStopPct', value: '5' },
    { key: 'topCandidatesCount', value: '10' },
    { key: 'scanIntervalMs', value: '5000' },
    { key: 'symbolRefreshIntervalMs', value: '5000' },
    { key: 'tickerSnapshotIntervalMs', value: '60000' },
    { key: 'priceHistoryHours', value: '2' },
    { key: 'tradeScoreThreshold', value: '80' },
    { key: 'replacementThreshold', value: '15' },
    { key: 'maxRangeExpansionRatio', value: '3' },
    { key: 'minQuoteVolume24h', value: '10000000' },
    { key: 'minOpenInterestNotional', value: '5000000' },
    { key: 'weightMomentum', value: '40' },
    { key: 'weightTrend', value: '20' },
    { key: 'weightVolume', value: '15' },
    { key: 'weightBreakout', value: '15' },
    { key: 'weightCandle', value: '10' },
    { key: 'mwt30s', value: '0.05' },
    { key: 'mwt1m', value: '0.10' },
    { key: 'mwt2m', value: '0.15' },
    { key: 'mwt5m', value: '0.20' },
    { key: 'mwt10m', value: '0.20' },
    { key: 'mwt15m', value: '0.15' },
    { key: 'mwt30m', value: '0.15' },
    { key: 'maxDailyDrawdownPct', value: '5' },
    { key: 'maxExposurePct', value: '80' },
    { key: 'cooldownEntries', value: '3' },
    { key: 'cooldownWindowMin', value: '10' },
    { key: 'cooldownDurationMin', value: '5' },
    { key: 'paperTrading', value: 'true' },
    { key: 'tradingEnabled', value: 'false' },
    { key: 'symbols', value: JSON.stringify(['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','AVAXUSDT','LINKUSDT','MATICUSDT']) },
  ];

  for (const d of defaults) {
    await prisma.botConfig.upsert({ where: { key: d.key }, update: {}, create: d });
  }

  console.log('✓ Default configuration seeded');
}

main().catch(console.error).finally(() => prisma.$disconnect());
