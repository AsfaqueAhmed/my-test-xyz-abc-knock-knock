import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MarketScannerService } from '../market-scanner/market-scanner.service';
import { BotConfigService } from '../config/bot-config.service';

export interface MomentumScore {
  symbol: string;
  score: number;           // weighted momentum score
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  changes: {
    s30: number; m1: number; m2: number;
    m5: number; m10: number; m15: number; m30: number;
  };
}

export interface RankedCandidate {
  symbol: string;
  score: number;
  direction: 'BULLISH' | 'BEARISH';
  rank: number;
  changes: MomentumScore['changes'];
}

export interface FalseAlarmRecord {
  symbol: string;
  consecutiveFailures: number;   // resets when symbol leaves top10 or passes
  offenseCount: number;          // total times false-alarmed — drives dynamic cooldown
  cooldownEndsAtTurn: number;    // turn when cooldown expires (0 = not in cooldown)
  lastUpdatedTurn: number;
}

@Injectable()
export class MomentumRankerService {
  private readonly logger = new Logger(MomentumRankerService.name);

  private topBullish: RankedCandidate[] = [];
  private topBearish: RankedCandidate[] = [];
  private lastScores: Map<string, MomentumScore> = new Map();

  // False alarm state per symbol
  private falseAlarms: Map<string, FalseAlarmRecord> = new Map();

  constructor(
    private readonly scanner: MarketScannerService,
    private readonly config: BotConfigService,
    private readonly events: EventEmitter2,
  ) {}

  @OnEvent('scanner.tick')
  onScannerTick({ turn }: { turn: number; timestamp: number }) {
    this.rankAll(turn);
  }

  private rankAll(turn: number) {
    const cfg = this.config.get();
    const now = Date.now();
    const symbols = this.scanner.getAllSymbols();
    const symbolSet = new Set(symbols);

    // Prune scores for symbols that have been removed from the exchange
    for (const sym of this.lastScores.keys()) {
      if (!symbolSet.has(sym)) this.lastScores.delete(sym);
    }

    const scores: MomentumScore[] = [];

    for (const symbol of symbols) {
      const score = this.calcMomentum(symbol, now, cfg);
      if (score) {
        this.lastScores.set(symbol, score);
        scores.push(score);
      }
    }

    // Sort bullish (highest positive) and bearish (most negative)
    const bullish = scores
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score);

    const bearish = scores
      .filter(s => s.score < 0)
      .sort((a, b) => a.score - b.score); // most negative first

    // Apply false alarm filter to get effective top lists
    this.topBullish = this.applyFalseAlarmFilter(bullish, 'BULLISH', cfg, turn);
    this.topBearish = this.applyFalseAlarmFilter(bearish, 'BEARISH', cfg, turn);

    // Update consecutive failure counters for symbols that LEFT top 10
    this.updateFalseAlarmCounters(
      this.topBullish.map(c => c.symbol),
      this.topBearish.map(c => c.symbol),
      turn,
    );

    this.events.emit('ranker.updated', {
      turn,
      topBullish: this.topBullish,
      topBearish: this.topBearish,
    });
  }

  private calcMomentum(
    symbol: string,
    now: number,
    cfg: ReturnType<BotConfigService['get']>,
  ): MomentumScore | null {
    const currentPrice = this.scanner.getCurrentPrice(symbol);
    if (!currentPrice) return null;

    const get = (msAgo: number): number | null =>
      this.scanner.getPriceAt(symbol, now - msAgo) ??
      this.scanner.getPriceByIndex(symbol, Math.round(msAgo / cfg.scanIntervalMs));

    const pct = (past: number | null): number => {
      if (!past || past === 0) return 0;
      return ((currentPrice - past) / past) * 100;
    };

    const p30s  = get(30_000);
    const p1m   = get(60_000);
    const p2m   = get(120_000);
    const p5m   = get(300_000);
    const p10m  = get(600_000);
    const p15m  = get(900_000);
    const p30m  = get(1_800_000);

    // Need at least 30s of history
    if (!p30s) return null;

    const changes = {
      s30: pct(p30s),
      m1:  pct(p1m),
      m2:  pct(p2m),
      m5:  pct(p5m),
      m10: pct(p10m),
      m15: pct(p15m),
      m30: pct(p30m),
    };

    const score =
      cfg.mwt30s  * changes.s30 +
      cfg.mwt1m   * changes.m1  +
      cfg.mwt2m   * changes.m2  +
      cfg.mwt5m   * changes.m5  +
      cfg.mwt10m  * changes.m10 +
      cfg.mwt15m  * changes.m15 +
      cfg.mwt30m  * changes.m30;

    const direction =
      score > 0.05 ? 'BULLISH' :
      score < -0.05 ? 'BEARISH' :
      'NEUTRAL';

    return { symbol, score, direction, changes };
  }

  // ─── False Alarm Filter ────────────────────────────────────────────────────

  private applyFalseAlarmFilter(
    ranked: MomentumScore[],
    direction: 'BULLISH' | 'BEARISH',
    cfg: ReturnType<BotConfigService['get']>,
    turn: number,
  ): RankedCandidate[] {
    const result: RankedCandidate[] = [];
    let rank = 1;
    let idx = 0;

    while (result.length < cfg.topCandidatesCount && idx < ranked.length) {
      const s = ranked[idx++];
      const fa = this.getOrCreateFalseAlarm(s.symbol);

      // Check if in active cooldown
      if (fa.cooldownEndsAtTurn > turn) {
        const remaining = fa.cooldownEndsAtTurn - turn;
        // Skip this symbol — use next in ranking
        this.logger.debug(
          `${s.symbol} in false alarm cooldown (${remaining} turns left, offense #${fa.offenseCount})`
        );
        continue;
      }

      result.push({
        symbol: s.symbol,
        score: s.score,
        direction,
        rank: rank++,
        changes: s.changes,
      });
    }

    return result;
  }

  // Called by DeepAnalysisService when a symbol fails trade validation
  recordFailure(symbol: string, turn: number) {
    const cfg = this.config.get();
    const fa = this.getOrCreateFalseAlarm(symbol);
    fa.consecutiveFailures++;
    fa.lastUpdatedTurn = turn;

    this.logger.debug(
      `${symbol} consecutive failures: ${fa.consecutiveFailures}/${cfg.falseAlarmFailureThreshold}`
    );

    if (fa.consecutiveFailures >= cfg.falseAlarmFailureThreshold) {
      fa.offenseCount++;
      fa.consecutiveFailures = 0;

      // Dynamic cooldown: base × multiplier^(offenseCount-1), capped at max
      const cooldown = Math.min(
        cfg.falseAlarmBaseCooldown * Math.pow(cfg.falseAlarmMultiplier, fa.offenseCount - 1),
        cfg.falseAlarmMaxCooldown,
      );
      fa.cooldownEndsAtTurn = turn + cooldown;

      this.logger.warn(
        `${symbol} → false alarm #${fa.offenseCount}. ` +
        `Cooldown: ${cooldown} turns (ends turn ${fa.cooldownEndsAtTurn})`
      );

      this.events.emit('falseAlarm.triggered', {
        symbol,
        offenseCount: fa.offenseCount,
        cooldownTurns: cooldown,
        cooldownEndsAtTurn: fa.cooldownEndsAtTurn,
      });
    }

    this.falseAlarms.set(symbol, fa);
  }

  // Called by DeepAnalysisService when a symbol passes trade validation
  recordPass(symbol: string) {
    const fa = this.falseAlarms.get(symbol);
    if (fa) {
      fa.consecutiveFailures = 0;
      this.falseAlarms.set(symbol, fa);
    }
  }

  // Track which symbols are currently in the top list (for logging only).
  // We deliberately do NOT reset consecutiveFailures here: a symbol that briefly
  // drops off the list and comes back should not get a free reset — failures must
  // accumulate until the symbol either passes validation (recordPass) or hits the
  // threshold and enters cooldown (recordFailure).
  private updateFalseAlarmCounters(
    bullishSymbols: string[],
    bearishSymbols: string[],
    _turn: number,
  ) {
    const inTop = new Set([...bullishSymbols, ...bearishSymbols]);
    for (const [symbol, fa] of this.falseAlarms) {
      if (!inTop.has(symbol) && fa.consecutiveFailures > 0) {
        this.logger.debug(
          `${symbol} left top list with ${fa.consecutiveFailures} pending failures (not reset)`,
        );
      }
    }
  }

  private getOrCreateFalseAlarm(symbol: string): FalseAlarmRecord {
    if (!this.falseAlarms.has(symbol)) {
      this.falseAlarms.set(symbol, {
        symbol,
        consecutiveFailures: 0,
        offenseCount: 0,
        cooldownEndsAtTurn: 0,
        lastUpdatedTurn: 0,
      });
    }
    return this.falseAlarms.get(symbol)!;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  getTopBullish(): RankedCandidate[] { return [...this.topBullish]; }
  getTopBearish(): RankedCandidate[] { return [...this.topBearish]; }
  getAllScores(): MomentumScore[] { return Array.from(this.lastScores.values()); }
  getMomentumScore(symbol: string): MomentumScore | null { return this.lastScores.get(symbol) ?? null; }
  getFalseAlarmState(symbol: string): FalseAlarmRecord | null { return this.falseAlarms.get(symbol) ?? null; }
  getAllFalseAlarms(): FalseAlarmRecord[] { return Array.from(this.falseAlarms.values()); }
}
