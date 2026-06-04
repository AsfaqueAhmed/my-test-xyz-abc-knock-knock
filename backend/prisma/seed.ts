import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Seed default config
  const defaults = [
    { key: 'maxActiveSymbols', value: '5' },
    { key: 'maxEntriesPerSymbol', value: '3' },
    { key: 'maxCapitalPerEntry', value: '1000' },
    { key: 'initialBalance', value: '10000' },
    { key: 'leverage', value: '5' },
    { key: 'activationPct', value: '2' },
    { key: 'trailingPct', value: '3' },
    { key: 'hardStopPct', value: '5' },
    { key: 'momentumThreshold', value: '0.3' },
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
