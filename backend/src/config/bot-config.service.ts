import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface BotConfiguration {
  // Portfolio
  maxActivePositions: number;
  maxEntriesPerSymbol: number;
  maxCapitalPerEntry: number;
  initialBalance: number;
  leverage: number;

  // Position management
  activationPct: number;
  trailingPct: number;
  hardStopPct: number;

  // Pipeline
  topCandidatesCount: number;        // how many from each side go to deep analysis (default 10)
  scanIntervalMs: number;            // snapshot frequency ms (default 5000)
  priceHistoryHours: number;         // rolling price cache hours (default 2)
  tradeScoreThreshold: number;       // min score to trade (default 80)
  replacementThreshold: number;      // min opportunity score to replace (default 15)

  // Trade score weights (must sum to 100)
  weightMomentum: number;            // default 40
  weightTrend: number;               // default 20
  weightVolume: number;              // default 15
  weightBreakout: number;            // default 15
  weightCandle: number;              // default 10

  // Momentum weights (must sum to 1)
  mwt30s: number;
  mwt1m: number;
  mwt2m: number;
  mwt5m: number;
  mwt10m: number;
  mwt15m: number;
  mwt30m: number;

  // False alarm filter
  falseAlarmFailureThreshold: number;  // consecutive failures before cooldown (default 50)
  falseAlarmBaseCooldown: number;      // base turns (default 100)
  falseAlarmMultiplier: number;        // doubling factor (default 2)
  falseAlarmMaxCooldown: number;       // cap (default 1600)

  // Risk
  maxDailyDrawdownPct: number;
  maxExposurePct: number;
  cooldownEntries: number;
  cooldownWindowMin: number;
  cooldownDurationMin: number;

  paperTrading: boolean;
  tradingEnabled: boolean;
}

const DEFAULTS: BotConfiguration = {
  maxActivePositions: 5,
  maxEntriesPerSymbol: 3,
  maxCapitalPerEntry: 1000,
  initialBalance: 10000,
  leverage: 5,
  activationPct: 2,
  trailingPct: 3,
  hardStopPct: 5,
  topCandidatesCount: 10,
  scanIntervalMs: 5000,
  priceHistoryHours: 2,
  tradeScoreThreshold: 80,
  replacementThreshold: 15,
  weightMomentum: 40,
  weightTrend: 20,
  weightVolume: 15,
  weightBreakout: 15,
  weightCandle: 10,
  mwt30s: 0.05,
  mwt1m: 0.10,
  mwt2m: 0.15,
  mwt5m: 0.20,
  mwt10m: 0.20,
  mwt15m: 0.15,
  mwt30m: 0.15,
  falseAlarmFailureThreshold: 50,
  falseAlarmBaseCooldown: 100,
  falseAlarmMultiplier: 2,
  falseAlarmMaxCooldown: 1600,
  maxDailyDrawdownPct: 5,
  maxExposurePct: 80,
  cooldownEntries: 3,
  cooldownWindowMin: 10,
  cooldownDurationMin: 5,
  paperTrading: true,
  tradingEnabled: false,
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

      const num = (k: string, d: number) => map[k] !== undefined ? parseFloat(map[k]) : d;
      const bool = (k: string, d: boolean) => map[k] !== undefined ? map[k] === 'true' : d;

      this.config = {
        maxActivePositions: num('maxActivePositions', DEFAULTS.maxActivePositions),
        maxEntriesPerSymbol: num('maxEntriesPerSymbol', DEFAULTS.maxEntriesPerSymbol),
        maxCapitalPerEntry: num('maxCapitalPerEntry', DEFAULTS.maxCapitalPerEntry),
        initialBalance: num('initialBalance', DEFAULTS.initialBalance),
        leverage: num('leverage', DEFAULTS.leverage),
        activationPct: num('activationPct', DEFAULTS.activationPct),
        trailingPct: num('trailingPct', DEFAULTS.trailingPct),
        hardStopPct: num('hardStopPct', DEFAULTS.hardStopPct),
        topCandidatesCount: num('topCandidatesCount', DEFAULTS.topCandidatesCount),
        scanIntervalMs: num('scanIntervalMs', DEFAULTS.scanIntervalMs),
        priceHistoryHours: num('priceHistoryHours', DEFAULTS.priceHistoryHours),
        tradeScoreThreshold: num('tradeScoreThreshold', DEFAULTS.tradeScoreThreshold),
        replacementThreshold: num('replacementThreshold', DEFAULTS.replacementThreshold),
        weightMomentum: num('weightMomentum', DEFAULTS.weightMomentum),
        weightTrend: num('weightTrend', DEFAULTS.weightTrend),
        weightVolume: num('weightVolume', DEFAULTS.weightVolume),
        weightBreakout: num('weightBreakout', DEFAULTS.weightBreakout),
        weightCandle: num('weightCandle', DEFAULTS.weightCandle),
        mwt30s: num('mwt30s', DEFAULTS.mwt30s),
        mwt1m: num('mwt1m', DEFAULTS.mwt1m),
        mwt2m: num('mwt2m', DEFAULTS.mwt2m),
        mwt5m: num('mwt5m', DEFAULTS.mwt5m),
        mwt10m: num('mwt10m', DEFAULTS.mwt10m),
        mwt15m: num('mwt15m', DEFAULTS.mwt15m),
        mwt30m: num('mwt30m', DEFAULTS.mwt30m),
        falseAlarmFailureThreshold: num('falseAlarmFailureThreshold', DEFAULTS.falseAlarmFailureThreshold),
        falseAlarmBaseCooldown: num('falseAlarmBaseCooldown', DEFAULTS.falseAlarmBaseCooldown),
        falseAlarmMultiplier: num('falseAlarmMultiplier', DEFAULTS.falseAlarmMultiplier),
        falseAlarmMaxCooldown: num('falseAlarmMaxCooldown', DEFAULTS.falseAlarmMaxCooldown),
        maxDailyDrawdownPct: num('maxDailyDrawdownPct', DEFAULTS.maxDailyDrawdownPct),
        maxExposurePct: num('maxExposurePct', DEFAULTS.maxExposurePct),
        cooldownEntries: num('cooldownEntries', DEFAULTS.cooldownEntries),
        cooldownWindowMin: num('cooldownWindowMin', DEFAULTS.cooldownWindowMin),
        cooldownDurationMin: num('cooldownDurationMin', DEFAULTS.cooldownDurationMin),
        paperTrading: bool('paperTrading', DEFAULTS.paperTrading),
        tradingEnabled: bool('tradingEnabled', DEFAULTS.tradingEnabled),
      };
    } catch (err) {
      this.logger.warn('Could not load config, using defaults: ' + err.message);
    }
  }

  get(): BotConfiguration { return { ...this.config }; }

  async update(partial: Partial<BotConfiguration>): Promise<BotConfiguration> {
    this.config = { ...this.config, ...partial };
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
