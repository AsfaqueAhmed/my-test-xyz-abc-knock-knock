import { Injectable, OnModuleInit, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface BotConfiguration {
  // Portfolio
  maxActivePositions: number;
  maxEntriesPerSymbol: number;
  maxCapitalPerEntry: number;
  leverage: number;

  // Position management
  activationPct: number;
  trailingPct: number;
  hardStopPct: number;

  // Pipeline
  topCandidatesCount: number;        // how many from each side go to deep analysis (default 10)
  scanIntervalMs: number;            // fetch prices + snapshot frequency ms (default 5000)
  priceHistoryHours: number;         // rolling price cache hours (default 2)
  tradeScoreThreshold: number;       // min score to trade (default 80)
  replacementThreshold: number;      // min opportunity score to replace (default 15)
  maxRangeExpansionRatio: number;    // reject candles expanded far beyond recent range
  minQuoteVolume24h: number;         // used for liquidity score normalisation
  minOpenInterestNotional: number;   // used for liquidity score normalisation
  minPositionSize: number;           // min safe position size in $ to allow a trade (default 50)

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

  requireVolumeGate: boolean;
  replacementEnabled: boolean;
  exposureCheckEnabled: boolean;

  // Exchange credentials (stored encrypted in DB; never logged)
  binanceApiKey: string;
  binanceApiSecret: string;
  binanceTestnet: boolean;

  paperTrading: boolean;
  tradingEnabled: boolean;
  botRunning: boolean;
  botPaused: boolean;
}

const DEFAULTS: BotConfiguration = {
  maxActivePositions: 5,
  maxEntriesPerSymbol: 3,
  maxCapitalPerEntry: 1000,
  leverage: 5,
  activationPct: 5,
  trailingPct: 3,
  hardStopPct: 5,
  topCandidatesCount: 10,
  scanIntervalMs: 5000,
  priceHistoryHours: 2,
  tradeScoreThreshold: 80,
  replacementThreshold: 15,
  maxRangeExpansionRatio: 3,
  minQuoteVolume24h: 10_000_000,
  minOpenInterestNotional: 5_000_000,
  minPositionSize: 50,
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
  // Notional exposure limit as % of current balance. With 5x leverage and $1000/entry,
  // each position = $5000 notional. 150% of balance → max ~3 concurrent $1000 entries on a $10k balance.
  maxExposurePct: 150,
  cooldownEntries: 3,
  cooldownWindowMin: 10,
  cooldownDurationMin: 5,
  requireVolumeGate: true,
  replacementEnabled: true,
  exposureCheckEnabled: true,

  binanceApiKey: '',
  binanceApiSecret: '',
  binanceTestnet: false,

  paperTrading: true,
  tradingEnabled: false,
  botRunning: false,
  botPaused: false,
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

      const num  = (k: string, d: number)  => map[k] !== undefined ? parseFloat(map[k]) : d;
      const bool = (k: string, d: boolean) => map[k] !== undefined ? map[k] === 'true' : d;
      const str  = (k: string, d: string)  => map[k] !== undefined ? map[k] : d;

      this.config = {
        maxActivePositions: num('maxActivePositions', DEFAULTS.maxActivePositions),
        maxEntriesPerSymbol: num('maxEntriesPerSymbol', DEFAULTS.maxEntriesPerSymbol),
        maxCapitalPerEntry: num('maxCapitalPerEntry', DEFAULTS.maxCapitalPerEntry),
        leverage: num('leverage', DEFAULTS.leverage),
        activationPct: num('activationPct', DEFAULTS.activationPct),
        trailingPct: num('trailingPct', DEFAULTS.trailingPct),
        hardStopPct: num('hardStopPct', DEFAULTS.hardStopPct),
        topCandidatesCount: num('topCandidatesCount', DEFAULTS.topCandidatesCount),
        scanIntervalMs: num('scanIntervalMs', DEFAULTS.scanIntervalMs),
        priceHistoryHours: num('priceHistoryHours', DEFAULTS.priceHistoryHours),
        tradeScoreThreshold: num('tradeScoreThreshold', DEFAULTS.tradeScoreThreshold),
        replacementThreshold: num('replacementThreshold', DEFAULTS.replacementThreshold),
        maxRangeExpansionRatio: num('maxRangeExpansionRatio', DEFAULTS.maxRangeExpansionRatio),
        minQuoteVolume24h: num('minQuoteVolume24h', DEFAULTS.minQuoteVolume24h),
        minOpenInterestNotional: num('minOpenInterestNotional', DEFAULTS.minOpenInterestNotional),
        minPositionSize: num('minPositionSize', DEFAULTS.minPositionSize),
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
        requireVolumeGate: bool('requireVolumeGate', DEFAULTS.requireVolumeGate),
        replacementEnabled: bool('replacementEnabled', DEFAULTS.replacementEnabled),
        exposureCheckEnabled: bool('exposureCheckEnabled', DEFAULTS.exposureCheckEnabled),

        binanceApiKey:    str('binanceApiKey',    DEFAULTS.binanceApiKey),
        binanceApiSecret: str('binanceApiSecret', DEFAULTS.binanceApiSecret),
        binanceTestnet:   bool('binanceTestnet',  DEFAULTS.binanceTestnet),

        paperTrading: bool('paperTrading', DEFAULTS.paperTrading),
        tradingEnabled: bool('tradingEnabled', DEFAULTS.tradingEnabled),
        botRunning: bool('botRunning', DEFAULTS.botRunning),
        botPaused: bool('botPaused', DEFAULTS.botPaused),
      };
    } catch (err) {
      this.logger.warn('Could not load config, using defaults: ' + err.message);
    }
  }

  get(): BotConfiguration { return { ...this.config }; }

  getMode(): 'PAPER' | 'TESTNET' | 'LIVE' {
    if (this.config.paperTrading)   return 'PAPER';
    if (this.config.binanceTestnet) return 'TESTNET';
    return 'LIVE';
  }

  async update(partial: Partial<BotConfiguration>): Promise<BotConfiguration> {
    // Strip computed/read-only fields and masked credential placeholders that
    // the frontend echoes back on every save — storing them would corrupt the
    // real keys or pollute the config table with unknown keys.
    const sanitized: Partial<BotConfiguration & { binanceKeysSet?: unknown }> = { ...partial };
    delete sanitized.binanceKeysSet;
    if (sanitized.binanceApiKey?.includes('*'))      delete sanitized.binanceApiKey;
    if (sanitized.binanceApiSecret === '***hidden***') delete sanitized.binanceApiSecret;

    // Block disabling paper trading unless real API credentials are present
    if (sanitized.paperTrading === false) {
      const merged = { ...this.config, ...sanitized };
      if (!merged.binanceApiKey || !merged.binanceApiSecret) {
        throw new BadRequestException(
          'Cannot switch to live trading: binanceApiKey and binanceApiSecret must be configured first'
        );
      }
    }

    // Never log API credentials
    const loggable = Object.keys(sanitized).filter(k => k !== 'binanceApiKey' && k !== 'binanceApiSecret');
    if (loggable.length > 0) {
      this.logger.log(`Config updated: ${loggable.join(', ')}`);
    }

    this.config = { ...this.config, ...sanitized };
    for (const [key, value] of Object.entries(sanitized)) {
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
