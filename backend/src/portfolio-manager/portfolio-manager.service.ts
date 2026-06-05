import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { BotConfigService } from '../config/bot-config.service';
import { MarketScannerService } from '../market-scanner/market-scanner.service';
import { MomentumRankerService, RankedCandidate } from '../momentum-ranker/momentum-ranker.service';
import { DeepAnalysisService } from '../deep-analysis/deep-analysis.service';
import { TradeValidatorService, TradeValidationResult } from '../trade-validator/trade-validator.service';
import { PositionEngineService } from '../position-engine/position-engine.service';

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
  openedAt: Date;
}

@Injectable()
export class PortfolioManagerService implements OnModuleInit {
  private readonly logger = new Logger(PortfolioManagerService.name);

  // Latest position strength scores
  private positionScores: Map<string, PositionStrengthScore> = new Map();

  // Latest candidate scores from this turn
  private lastCandidates: TradeValidationResult[] = [];
  private lastValidationByPositionSide: Map<string, TradeValidationResult> = new Map();

  private botRunning = false;
  private botPaused = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: BotConfigService,
    private readonly scanner: MarketScannerService,
    private readonly ranker: MomentumRankerService,
    private readonly deepAnalysis: DeepAnalysisService,
    private readonly validator: TradeValidatorService,
    private readonly positionEngine: PositionEngineService,
    private readonly events: EventEmitter2,
  ) {}

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  async onModuleInit() {
    const cfg = this.config.get();
    if (cfg.botRunning) {
      this.botRunning = true;
      this.botPaused = cfg.botPaused;
      this.logger.log(`Bot state restored from DB: running=${this.botRunning} paused=${this.botPaused}`);
    }
  }

  // ─── Bot Control ──────────────────────────────────────────────────────────

  async start(triggeredBy = 'MANUAL') {
    this.botRunning = true; this.botPaused = false;
    await this.config.update({ botRunning: true, botPaused: false, tradingEnabled: true });
    this.logger.log('Portfolio manager started');
    this.events.emit('bot.started', { triggeredBy });
  }
  async stop(triggeredBy = 'MANUAL', reason?: string) {
    this.botRunning = false; this.botPaused = false;
    await this.config.update({ botRunning: false, botPaused: false, tradingEnabled: false });
    this.logger.log('Portfolio manager stopped');
    this.events.emit('bot.stopped', { triggeredBy, reason });
  }
  async pause(triggeredBy = 'MANUAL') {
    this.botPaused = true;
    await this.config.update({ botPaused: true });
    this.logger.log('Portfolio manager paused');
    this.events.emit('bot.paused', { triggeredBy });
  }
  async resume(triggeredBy = 'MANUAL') {
    this.botPaused = false;
    await this.config.update({ botPaused: false });
    this.logger.log('Portfolio manager resumed');
    this.events.emit('bot.resumed', { triggeredBy });
  }
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

    const allValidations: TradeValidationResult[] = [];
    const passingCandidates: TradeValidationResult[] = [];

    for (const candidate of allCandidates) {
      try {
        const momentum = this.ranker.getMomentumScore(candidate.symbol);
        if (!momentum) { this.ranker.recordFailure(candidate.symbol, turn, 'No momentum score — price history too thin'); continue; }

        const analysis = await this.deepAnalysis.analyse(candidate.symbol, candidate.direction);
        const validation = this.validator.validate(momentum, analysis);
        allValidations.push(validation);
        this.lastValidationByPositionSide.set(`${validation.symbol}:${validation.direction}`, validation);

        if (validation.passed) {
          this.ranker.recordPass(candidate.symbol);
          passingCandidates.push(validation);
        } else {
          const topReason = validation.failureReason ?? validation.reasons.slice(-1)[0] ?? 'Validation failed';
          this.ranker.recordFailure(candidate.symbol, turn, topReason);
        }
      } catch (err) {
        this.logger.error(`Deep analysis failed for ${candidate.symbol}: ${err.message}`);
        this.ranker.recordFailure(candidate.symbol, turn, `Analysis error: ${err.message}`);
      }
    }

    this.lastCandidates = allValidations.sort((a, b) => b.tradeScore - a.tradeScore);
    await this.persistCandidateScores(this.lastCandidates);

    await this.allocateCapital(passingCandidates, turn);
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

    await this.persistPositionScores(Array.from(this.positionScores.values()));
  }

  private async calcPositionStrength(pos: any): Promise<PositionStrengthScore> {
    const momentum = this.ranker.getMomentumScore(pos.symbol);
    const currentPrice = this.scanner.getCurrentPrice(pos.symbol);
    const isLong = pos.side === 'LONG';
    const inTrailing = pos.status === 'LONG_TRAILING' || pos.status === 'SHORT_TRAILING';
    const lastValidation = this.lastValidationByPositionSide.get(`${pos.symbol}:${pos.side}`);

    // Momentum component (0-30).
    // Uses the same 1% = full-scale convention as TradeValidatorService:
    // absScore * 30 gives 30 pts at 1% move; clamped to the 30-pt maximum.
    let momentumScore = 0;
    if (momentum) {
      const absScore = Math.abs(momentum.score);
      const directionMatch = isLong
        ? momentum.direction === 'BULLISH'
        : momentum.direction === 'BEARISH';
      momentumScore = directionMatch ? Math.min(absScore * 30, 30) : 0;
    }

    // Profit component (0-25) — reward profitable positions
    let profitScore = 0;
    if (currentPrice && pos.avgEntryPrice) {
      const pnlPct = isLong
        ? (currentPrice - Number(pos.avgEntryPrice)) / Number(pos.avgEntryPrice) * 100
        : (Number(pos.avgEntryPrice) - currentPrice) / Number(pos.avgEntryPrice) * 100;
      profitScore = Math.min(Math.max(pnlPct * 2.5, 0), 25);
    }

    // Trailing mode bonus (0-10) — reward positions that earned trailing protection
    const trailingBonus = inTrailing ? 5 : 0;

    // New extreme activity (0-10) — is it still making new highs/lows?
    let extremeScore = 0;
    let makingNewExtremes = false;
    if (inTrailing && currentPrice) {
      if (isLong && pos.highestPrice && currentPrice >= Number(pos.highestPrice) * 0.999) {
        extremeScore = 5;
        makingNewExtremes = true;
      } else if (!isLong && pos.lowestPrice && currentPrice <= Number(pos.lowestPrice) * 1.001) {
        extremeScore = 5;
        makingNewExtremes = true;
      }
    }

    // Volume component (0-10)
    let volumeScore = 0;
    const ticker = this.scanner.getTicker(pos.symbol);
    if (ticker) volumeScore = Math.min(ticker.volume24h / 1_000_000, 10);

    const trendScore = lastValidation ? lastValidation.trendScore * 0.15 : 0;
    const tradeScore = lastValidation ? lastValidation.tradeScore * 0.10 : 0;
    const totalScore = momentumScore + profitScore + trailingBonus + extremeScore + volumeScore + trendScore + tradeScore;

    // PROTECTED: never replace if trailing AND making new extremes AND momentum positive
    const protected_ = inTrailing && makingNewExtremes && momentumScore > 0;

    return {
      positionId: String(pos.id),
      symbol: pos.symbol,
      side: pos.side,
      score: Math.min(totalScore, 100),
      momentum: momentumScore,
      trendScore,
      profitScore,
      volumeScore,
      tradeScore,
      inTrailingMode: inTrailing,
      makingNewExtremes,
      protected: protected_,
      openedAt: pos.openedAt,
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

      const slotsAvailable = openCount < cfg.maxActivePositions;
      const balance = this.positionEngine.getBalance();
      const effectiveCapital = Math.min(cfg.maxCapitalPerEntry, balance * 0.1);
      const hasSufficientBalance = effectiveCapital > 0;

      if (slotsAvailable && hasSufficientBalance) {
        // Free slot with enough capital — open directly, no replacement needed
        this.events.emit('portfolio.openPosition', candidate);
        continue;
      }

      const reason = !slotsAvailable ? 'max positions filled' : `insufficient balance ($${balance.toFixed(2)})`;
      this.logger.debug(`Evaluating replacement for ${candidate.symbol} — ${reason}`);

      // Slot full or balance too low — evaluate opportunity cost
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
        // Remove from scores immediately so subsequent candidates in this turn
        // cannot select the same position for replacement again.
        this.positionScores.delete(weakest.positionId);
        this.events.emit('position.replaced', {
          closedSymbol: weakest.symbol,
          closedScore: weakest.score,
          newSymbol: candidate.symbol,
          newScore: candidateScore,
          opportunityScore,
        });
        this.events.emit('portfolio.replacePosition', {
          closePositionId: weakest.positionId,
          openCandidate: candidate,
          closedSymbol: weakest.symbol,
          closedScore: weakest.score,
          newScore: candidateScore,
          opportunityScore,
        });
      }
    }
  }

  private findWeakestReplaceablePosition(): PositionStrengthScore | null {
    const MIN_AGE_MS = 5 * 60 * 1000;
    const now = Date.now();
    const scores = Array.from(this.positionScores.values())
      .filter(s => !s.protected && (now - s.openedAt.getTime()) >= MIN_AGE_MS)
      .sort((a, b) => a.score - b.score);
    return scores[0] ?? null;
  }

  // ─── Score Persistence ────────────────────────────────────────────────────

  private async persistPositionScores(scores: PositionStrengthScore[]) {
    if (scores.length === 0) return;
    try {
      await this.prisma.portfolioScore.createMany({
        data: scores.map(s => ({
          positionId: BigInt(s.positionId),
          symbol: s.symbol,
          side: s.side,
          score: s.score,
          momentum: s.momentum,
          trendScore: s.trendScore,
          profitScore: s.profitScore,
          volumeScore: s.volumeScore,
          tradeScore: s.tradeScore,
          inTrailingMode: s.inTrailingMode,
          makingNewExtremes: s.makingNewExtremes,
          protected: s.protected,
        })),
      });
    } catch (_) {}
  }

  private async persistCandidateScores(candidates: TradeValidationResult[]) {
    if (candidates.length === 0) return;
    try {
      await this.prisma.candidateScore.createMany({
        data: candidates.map(v => ({
          symbol: v.symbol,
          direction: v.direction,
          score: v.tradeScore,
          momentumScore: v.momentumScore,
          trendScore: v.trendScore,
          volumeScore: v.volumeScore,
          breakoutScore: v.breakoutScore,
          candleScore: v.candleScore,
          liquidityScore: v.liquidityScore,
          volumeRatio: v.volumeRatio,
          quoteVolume24h: v.quoteVolume24h,
          openInterest: v.openInterest,
          openInterestNotional: v.openInterestNotional,
          passed: v.passed,
          reasons: v.reasons.join(' | '),
        })),
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
