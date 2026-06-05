import { Injectable, Logger } from '@nestjs/common';
import { BotConfigService } from '../config/bot-config.service';
import { DeepAnalysisResult } from '../deep-analysis/deep-analysis.service';
import { MomentumScore } from '../momentum-ranker/momentum-ranker.service';

export interface TradeValidationResult {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  tradeScore: number;          // 0-100 final weighted score
  momentumScore: number;       // 0-100
  trendScore: number;
  volumeScore: number;
  breakoutScore: number;
  candleScore: number;
  liquidityScore: number;
  volumeRatio: number;
  quoteVolume24h: number;
  openInterest: number;
  openInterestNotional: number;
  maxSafePositionSize: number;
  passed: boolean;
  failureReason?: string;      // primary reason when !passed
  reasons: string[];
}

@Injectable()
export class TradeValidatorService {
  private readonly logger = new Logger(TradeValidatorService.name);

  constructor(private readonly config: BotConfigService) {}

  validate(
    momentum: MomentumScore,
    analysis: DeepAnalysisResult,
  ): TradeValidationResult {
    const cfg = this.config.get();
    const reasons = [...analysis.reasons];

    // Normalise momentum score to 0-100.
    // momentum.score is the weighted % change across timeframes.
    // Treat ±1% as full score (100 pts); values above are clamped.
    // Previous divisor of 2 required a 2% move for 100 pts, leaving most
    // legitimate signals bunched at 25-50 pts with poor differentiation.
    const rawMomentum = Math.abs(momentum.score);
    const momentumScore = Math.min(rawMomentum * 100, 100);

    // Weighted final score
    const tradeScore =
      (momentumScore        * cfg.weightMomentum  / 100) +
      (analysis.trendScore  * cfg.weightTrend     / 100) +
      (analysis.volumeScore * cfg.weightVolume    / 100) +
      (analysis.breakoutScore * cfg.weightBreakout / 100) +
      (analysis.candleScore * cfg.weightCandle    / 100);

    const passed = tradeScore >= cfg.tradeScoreThreshold && analysis.passed;

    if (tradeScore >= cfg.tradeScoreThreshold) {
      reasons.push(`Trade score ${tradeScore.toFixed(1)} ≥ threshold ${cfg.tradeScoreThreshold}`);
    } else {
      reasons.push(`Trade score ${tradeScore.toFixed(1)} < threshold ${cfg.tradeScoreThreshold}`);
    }

    let failureReason: string | undefined;
    if (!passed) {
      if (tradeScore < cfg.tradeScoreThreshold) {
        failureReason = `Trade score ${tradeScore.toFixed(1)} < threshold ${cfg.tradeScoreThreshold}`;
      } else if (analysis.volumeRatio < 1.3) {
        failureReason = `Volume ratio ${analysis.volumeRatio.toFixed(2)} < 1.3`;
      } else if (!analysis.breakoutConfirmed) {
        failureReason = 'Breakout not confirmed';
      } else if (analysis.atrPct > 5) {
        failureReason = `ATR% ${analysis.atrPct.toFixed(2)} > 5`;
      } else if (analysis.rangeExpansion > cfg.maxRangeExpansionRatio) {
        failureReason = `Range expansion ${analysis.rangeExpansion.toFixed(2)}x > ${cfg.maxRangeExpansionRatio}x`;
      } else if (!analysis.liquidityPassed) {
        failureReason = `Liquidity too thin — max safe size $${analysis.maxSafePositionSize.toFixed(0)}`;
      } else {
        failureReason = 'Deep analysis failed';
      }
    }

    return {
      symbol: momentum.symbol,
      direction: analysis.direction,
      tradeScore,
      momentumScore,
      trendScore: analysis.trendScore,
      volumeScore: analysis.volumeScore,
      breakoutScore: analysis.breakoutScore,
      candleScore: analysis.candleScore,
      liquidityScore: analysis.liquidityScore,
      volumeRatio: analysis.volumeRatio,
      quoteVolume24h: analysis.quoteVolume24h,
      openInterest: analysis.openInterest,
      openInterestNotional: analysis.openInterestNotional,
      maxSafePositionSize: analysis.maxSafePositionSize,
      passed,
      failureReason,
      reasons,
    };
  }
}
