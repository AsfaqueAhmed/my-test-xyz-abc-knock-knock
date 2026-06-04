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
  passed: boolean;
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

    if (passed) {
      reasons.push(`Trade score ${tradeScore.toFixed(1)} ≥ threshold ${cfg.tradeScoreThreshold}`);
    } else {
      reasons.push(`Trade score ${tradeScore.toFixed(1)} < threshold ${cfg.tradeScoreThreshold}`);
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
      passed,
      reasons,
    };
  }
}
