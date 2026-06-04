import { Injectable } from '@nestjs/common';
import { Candle } from '../market-data/market-data.service';

export interface MomentumResult {
  score: number;
  confidence: number;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  changes: Record<string, number>;
}

export interface TrendResult {
  ema20: number;
  ema50: number;
  ema200: number;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}

export interface VolumeResult {
  current: number;
  average: number;
  ratio: number;
  confirmed: boolean;
}

export interface BreakoutResult {
  type: 'BULLISH' | 'BEARISH' | null;
  confirmed: boolean;
  level: number;
}

@Injectable()
export class IndicatorsService {
  calculateEMA(prices: number[], period: number): number {
    if (prices.length === 0) return 0;
    if (prices.length < period) {
      // Use SMA as fallback
      return prices.reduce((a, b) => a + b, 0) / prices.length;
    }
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < prices.length; i++) {
      ema = prices[i] * k + ema * (1 - k);
    }
    return ema;
  }

  calculateMomentum(
    candlesByTimeframe: Record<string, Candle[]>,
    currentPrice: number,
  ): MomentumResult {
    const weights: Record<string, number> = {
      '30s': 0.05,
      '1m': 0.10,
      '2m': 0.15,
      '5m': 0.20,
      '10m': 0.20,
      '15m': 0.15,
      '30m': 0.15,
    };

    const changes: Record<string, number> = {};
    let score = 0;
    let totalWeight = 0;

    for (const [tf, weight] of Object.entries(weights)) {
      const candles = candlesByTimeframe[tf] || [];
      if (candles.length < 2) {
        changes[tf] = 0;
        continue;
      }
      const prevClose = candles[candles.length - 2].close;
      const change = prevClose !== 0 ? ((currentPrice - prevClose) / prevClose) * 100 : 0;
      changes[tf] = change;
      score += weight * change;
      totalWeight += weight;
    }

    if (totalWeight > 0 && totalWeight < 1) {
      score = score / totalWeight;
    }

    const absScore = Math.abs(score);
    const confidence = Math.min(absScore / 2, 1); // 2% move = 100% confidence

    let direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    if (score > 0.1) direction = 'BULLISH';
    else if (score < -0.1) direction = 'BEARISH';
    else direction = 'NEUTRAL';

    return { score, confidence, direction, changes };
  }

  calculateTrend(candles1m: Candle[]): TrendResult {
    if (candles1m.length === 0) {
      return { ema20: 0, ema50: 0, ema200: 0, direction: 'NEUTRAL' };
    }
    const prices = candles1m.map(c => c.close);
    const ema20 = this.calculateEMA(prices, 20);
    const ema50 = this.calculateEMA(prices, 50);
    const ema200 = this.calculateEMA(prices, 200);

    let direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    if (ema20 > ema50 && ema50 > ema200) direction = 'BULLISH';
    else if (ema20 < ema50 && ema50 < ema200) direction = 'BEARISH';
    else direction = 'NEUTRAL';

    return { ema20, ema50, ema200, direction };
  }

  calculateVolume(candles: Candle[]): VolumeResult {
    if (candles.length === 0) {
      return { current: 0, average: 0, ratio: 0, confirmed: false };
    }
    const current = candles[candles.length - 1].volume;
    const lookback = candles.slice(-11, -1);
    const average = lookback.length > 0
      ? lookback.reduce((s, c) => s + c.volume, 0) / lookback.length
      : current;
    const ratio = average > 0 ? current / average : 0;
    return { current, average, ratio, confirmed: ratio > 1.5 };
  }

  calculateBreakout(candles: Candle[], currentPrice: number): BreakoutResult {
    if (candles.length < 4) {
      return { type: null, confirmed: false, level: 0 };
    }
    const prev3 = candles.slice(-4, -1);
    const highestHigh = Math.max(...prev3.map(c => c.high));
    const lowestLow = Math.min(...prev3.map(c => c.low));

    if (currentPrice > highestHigh) {
      return { type: 'BULLISH', confirmed: true, level: highestHigh };
    } else if (currentPrice < lowestLow) {
      return { type: 'BEARISH', confirmed: true, level: lowestLow };
    }
    return { type: null, confirmed: false, level: 0 };
  }
}
