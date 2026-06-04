import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { BotConfigService } from '../config/bot-config.service';
import { MarketScannerService } from '../market-scanner/market-scanner.service';
import { MomentumRankerService, RankedCandidate } from '../momentum-ranker/momentum-ranker.service';
import { DeepAnalysisService } from '../deep-analysis/deep-analysis.service';
import { TradeValidatorService, TradeValidationResult } from '../trade-validator/trade-validator.service';

export interface PositionStrengthScore {
  positionId: string;
  symbol: string;
  side: string;
  score: number;           // 0-100
  momentum: number;
  trendScore: number;
  profitScore: number;
  volumeScore: number;
  tradeScore: number;
  inTrailingMode: boolean;
  makingNewExtremes: boolean;
  protected: boolean;      // cannot be replaced
}

@Injectable()
export class PortfolioManagerService {
  private readonly logger = new Logger(PortfolioManagerService.name);

  // Latest position strength scores
  private positionScores: Map<string, PositionStrengthScore> = new Map();

  // Latest candidate scores from this turn
  private lastCandidates: TradeValidationResult[] = [];

  private botRunning = false;
  private botPaused = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: BotConfigService,
    private readonly scanner: MarketScannerService,
    private readonly ranker: MomentumRankerService,
    private readonly deepAnalysis: DeepAnalysisService,
    private readonly validator: TradeValidatorService,
    private readonly events: EventEmitter2,
  ) {}

  // ─── Bot Control ──────────────────────────────────────────────────────────

  start() { this.botRunning = true; this.botPaused = false; this.logger.log('Portfolio manager started'); }
  stop()  { this.botRunning = false; this.botPaused = false; this.logger.log('Portfolio manager stopped'); }
  pause() { this.botPaused = true;  this.logger.log('Portfolio manager paused'); }
  resume(){ this.botPaused = false; this.logger.log('Portfolio manager resumed'); }
  getStatus() { return { running: this.botRunning, paused: this.botPaused }; }

  // ─── Main Pipeline ────────────────────────────────────────────────────────

  @OnEvent('ranker.updated')
  async onRankerUpdated({ turn, topBullish, topBearish }: {
    turn: number;
    topBullish: RankedCandidate[];
    topBearish: RankedCandidate[];
  }) {
    const cfg = this.config.get();
    if (!this.botRunning || this.botPaused || !cfg.tradingEnabled) return;

    // Score all open positions first
    await this.scoreOpenPositions();

    // Run deep analysis + validation on all top candidates
    const allCandidates = [
      ...topBullish.map(c => ({ ...c, direction: 'LONG' as const })),
      ...topBearish.map(c => ({ ...c, direction: 'SHORT' as const })),
    ];

    const validatedCandidates: TradeValidationResult[] = [];

    for (const candidate of allCandidates) {
      try {
        const momentum = this.ranker.getMomentumScore(candidate.symbol);
        if (!momentum) { this.ranker.recordFailure(candidate.symbol, turn); continue; }

        const analysis = await this.deepAnalysis.analyse(candidate.symbol, candidate.direction);
        const validation = this.validator.validate(momentum, analysis);

        if (validation.passed) {
          this.ranker.recordPass(candidate.symbol);
          validatedCandidates.push(validation);
        } else {
          this.ranker.recordFailure(candidate.symbol, turn);
        }
      } catch (err) {
        this.logger.error(`Deep analysis failed for ${candidate.symbol}: ${err.message}`);
        this.ranker.recordFailure(candidate.symbol, turn);
      }
    }

    this.lastCandidates = validatedCandidates;

    // Persist passing signals
    for (const v of validatedCandidates) {
      await this.persistSignal(v);
    }

    // Allocate capital
    await this.allocateCapital(validatedCandidates, turn);
  }

  // ─── Position Scoring ─────────────────────────────────────────────────────

  private async scoreOpenPositions() {
    const openPositions = await this.prisma.position.findMany({
      where: { status: { in: ['OPEN_LONG', 'LONG_TRAILING', 'OPEN_SHORT', 'SHORT_TRAILING'] } },
    });

    this.positionScores.clear();

    for (const pos of openPositions) {
      const score = await this.calcPositionStrength(pos);
      this.positionScores.set(String(pos.id), score);
    }
  }

  private async calcPositionStrength(pos: any): Promise<PositionStrengthScore> {
    const momentum = this.ranker.getMomentumScore(pos.symbol);
    const currentPrice = this.scanner.getCurrentPrice(pos.symbol);
    const isLong = pos.side === 'LONG';
    const inTrailing = pos.status === 'LONG_TRAILING' || pos.status === 'SHORT_TRAILING';

    // Momentum component (0-40)
    let momentumScore = 0;
    if (momentum) {
      const absScore = Math.abs(momentum.score);
      const directionMatch = isLong
        ? momentum.direction === 'BULLISH'
        : momentum.direction === 'BEARISH';
      momentumScore = directionMatch ? Math.min(absScore / 2 * 40, 40) : 0;
    }

    // Profit component (0-30) — reward profitable positions
    let profitScore = 0;
    if (currentPrice && pos.avgEntryPrice) {
      const pnlPct = isLong
        ? (currentPrice - Number(pos.avgEntryPrice)) / Number(pos.avgEntryPrice) * 100
        : (Number(pos.avgEntryPrice) - currentPrice) / Number(pos.avgEntryPrice) * 100;
      profitScore = Math.min(Math.max(pnlPct * 3, 0), 30);
    }

    // Trailing mode bonus (0-10) — reward positions that earned trailing protection
    const trailingBonus = inTrailing ? 10 : 0;

    // New extreme activity (0-10) — is it still making new highs/lows?
    let extremeScore = 0;
    let makingNewExtremes = false;
    if (inTrailing && currentPrice) {
      if (isLong && pos.highestPrice && currentPrice >= Number(pos.highestPrice) * 0.999) {
        extremeScore = 10;
        makingNewExtremes = true;
      } else if (!isLong && pos.lowestPrice && currentPrice <= Number(pos.lowestPrice) * 1.001) {
        extremeScore = 10;
        makingNewExtremes = true;
      }
    }

    // Volume component (0-10)
    let volumeScore = 0;
    const ticker = this.scanner.getTicker(pos.symbol);
    if (ticker) volumeScore = Math.min(ticker.volume24h / 1_000_000, 10);

    const totalScore = momentumScore + profitScore + trailingBonus + extremeScore + volumeScore;

    // PROTECTED: never replace if trailing AND making new extremes AND momentum positive
    const protected_ = inTrailing && makingNewExtremes && momentumScore > 0;

    return {
      positionId: String(pos.id),
      symbol: pos.symbol,
      side: pos.side,
      score: Math.min(totalScore, 100),
      momentum: momentumScore,
      trendScore: 0,
      profitScore,
      volumeScore,
      tradeScore: 0,
      inTrailingMode: inTrailing,
      makingNewExtremes,
      protected: protected_,
    };
  }

  // ─── Capital Allocation ───────────────────────────────────────────────────

  private async allocateCapital(candidates: TradeValidationResult[], turn: number) {
    if (candidates.length === 0) return;
    const cfg = this.config.get();

    for (const candidate of candidates) {
      const openCount = await this.prisma.position.count({
        where: { status: { in: ['OPEN_LONG', 'LONG_TRAILING', 'OPEN_SHORT', 'SHORT_TRAILING'] } },
      });

      if (openCount < cfg.maxActivePositions) {
        // Free slot — open directly
        this.events.emit('portfolio.openPosition', candidate);
        continue;
      }

      // No free slot — evaluate opportunity cost
      const weakest = this.findWeakestReplaceablePosition();
      if (!weakest) {
        this.logger.debug(`No capital for ${candidate.symbol} — all positions protected`);
        continue;
      }

      const candidateScore = candidate.tradeScore;
      const opportunityScore = candidateScore - weakest.score;

      this.logger.debug(
        `Opportunity cost: ${candidate.symbol}(${candidateScore.toFixed(1)}) - ` +
        `${weakest.symbol}(${weakest.score.toFixed(1)}) = ${opportunityScore.toFixed(1)}`
      );

      if (
        candidateScore > weakest.score &&
        opportunityScore >= cfg.replacementThreshold
      ) {
        this.logger.log(
          `Replacing ${weakest.symbol} (score ${weakest.score.toFixed(1)}) ` +
          `with ${candidate.symbol} (score ${candidateScore.toFixed(1)}, ` +
          `opportunity +${opportunityScore.toFixed(1)})`
        );
        this.events.emit('portfolio.replacePosition', {
          closePositionId: weakest.positionId,
          openCandidate: candidate,
        });
      }
    }
  }

  private findWeakestReplaceablePosition(): PositionStrengthScore | null {
    const scores = Array.from(this.positionScores.values())
      .filter(s => !s.protected)
      .sort((a, b) => a.score - b.score);
    return scores[0] ?? null;
  }

  // ─── Signal Persistence ───────────────────────────────────────────────────

  private async persistSignal(v: TradeValidationResult) {
    try {
      await this.prisma.signal.create({
        data: {
          symbol: v.symbol,
          direction: v.direction,
          momentumScore: v.momentumScore / 100,
          confidence: v.tradeScore / 100,
          trendDirection: v.trendScore >= 100 ? (v.direction === 'LONG' ? 'BULLISH' : 'BEARISH') : 'NEUTRAL',
          volumeRatio: v.volumeScore / 100,
          breakoutType: v.breakoutScore > 0 ? (v.direction === 'LONG' ? 'BULLISH' : 'BEARISH') : null,
          acted: false,
        },
      });
    } catch (_) {}
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  getPositionScores(): PositionStrengthScore[] {
    return Array.from(this.positionScores.values());
  }

  getLastCandidates(): TradeValidationResult[] {
    return [...this.lastCandidates];
  }
}
