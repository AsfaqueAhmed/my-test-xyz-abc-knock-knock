import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface BotConfiguration {
  maxActiveSymbols: number;
  maxEntriesPerSymbol: number;
  maxCapitalPerEntry: number;
  initialBalance: number;
  leverage: number;
  activationPct: number;
  trailingPct: number;
  hardStopPct: number;
  momentumThreshold: number;
  maxDailyDrawdownPct: number;
  maxExposurePct: number;
  cooldownEntries: number;
  cooldownWindowMin: number;
  cooldownDurationMin: number;
  paperTrading: boolean;
  tradingEnabled: boolean;
  symbols: string[];
}

const DEFAULTS: BotConfiguration = {
  maxActiveSymbols: 5,
  maxEntriesPerSymbol: 3,
  maxCapitalPerEntry: 1000,
  initialBalance: 10000,
  leverage: 5,
  activationPct: 2,
  trailingPct: 3,
  hardStopPct: 5,
  momentumThreshold: 0.3,
  maxDailyDrawdownPct: 5,
  maxExposurePct: 80,
  cooldownEntries: 3,
  cooldownWindowMin: 10,
  cooldownDurationMin: 5,
  paperTrading: true,
  tradingEnabled: false,
  symbols: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'MATICUSDT'],
};

@Injectable()
export class BotConfigService implements OnModuleInit {
  private readonly logger = new Logger(BotConfigService.name);
  private config: BotConfiguration = { ...DEFAULTS };

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.loadConfig();
  }

  async loadConfig() {
    try {
      const records = await this.prisma.botConfig.findMany();
      const map: Record<string, string> = {};
      for (const r of records) map[r.key] = r.value;

      this.config = {
        maxActiveSymbols: map.maxActiveSymbols ? parseInt(map.maxActiveSymbols) : DEFAULTS.maxActiveSymbols,
        maxEntriesPerSymbol: map.maxEntriesPerSymbol ? parseInt(map.maxEntriesPerSymbol) : DEFAULTS.maxEntriesPerSymbol,
        maxCapitalPerEntry: map.maxCapitalPerEntry ? parseFloat(map.maxCapitalPerEntry) : DEFAULTS.maxCapitalPerEntry,
        initialBalance: map.initialBalance ? parseFloat(map.initialBalance) : DEFAULTS.initialBalance,
        leverage: map.leverage ? parseInt(map.leverage) : DEFAULTS.leverage,
        activationPct: map.activationPct ? parseFloat(map.activationPct) : DEFAULTS.activationPct,
        trailingPct: map.trailingPct ? parseFloat(map.trailingPct) : DEFAULTS.trailingPct,
        hardStopPct: map.hardStopPct ? parseFloat(map.hardStopPct) : DEFAULTS.hardStopPct,
        momentumThreshold: map.momentumThreshold ? parseFloat(map.momentumThreshold) : DEFAULTS.momentumThreshold,
        maxDailyDrawdownPct: map.maxDailyDrawdownPct ? parseFloat(map.maxDailyDrawdownPct) : DEFAULTS.maxDailyDrawdownPct,
        maxExposurePct: map.maxExposurePct ? parseFloat(map.maxExposurePct) : DEFAULTS.maxExposurePct,
        cooldownEntries: map.cooldownEntries ? parseInt(map.cooldownEntries) : DEFAULTS.cooldownEntries,
        cooldownWindowMin: map.cooldownWindowMin ? parseInt(map.cooldownWindowMin) : DEFAULTS.cooldownWindowMin,
        cooldownDurationMin: map.cooldownDurationMin ? parseInt(map.cooldownDurationMin) : DEFAULTS.cooldownDurationMin,
        paperTrading: map.paperTrading !== undefined ? map.paperTrading === 'true' : DEFAULTS.paperTrading,
        tradingEnabled: map.tradingEnabled !== undefined ? map.tradingEnabled === 'true' : DEFAULTS.tradingEnabled,
        symbols: map.symbols ? JSON.parse(map.symbols) : DEFAULTS.symbols,
      };
    } catch (err) {
      this.logger.warn('Could not load config from DB, using defaults: ' + err.message);
    }
  }

  get(): BotConfiguration {
    return { ...this.config };
  }

  async update(partial: Partial<BotConfiguration>): Promise<BotConfiguration> {
    this.config = { ...this.config, ...partial };
    
    // Persist each changed key
    for (const [key, value] of Object.entries(partial)) {
      const strValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
      await this.prisma.botConfig.upsert({
        where: { key },
        update: { value: strValue },
        create: { key, value: strValue },
      });
    }
    return this.get();
  }

  async setTradingEnabled(enabled: boolean) {
    return this.update({ tradingEnabled: enabled });
  }
}
