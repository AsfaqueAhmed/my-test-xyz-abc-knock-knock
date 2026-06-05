import { Injectable, Logger } from '@nestjs/common';
import { BotConfigService } from '../config/bot-config.service';
import { MarketScannerService } from '../market-scanner/market-scanner.service';

export interface CandleData {
  open: number; high: number; low: number; close: number;
  volume: number; openTime: number;
}

export interface DeepAnalysisResult {
  symbol: string;
  direction: 'LONG' | 'SHORT';
  trendScore: number;       // 0-100
  volumeScore: number;      // 0-100
  breakoutScore: number;    // 0-100
  candleScore: number;      // 0-100
  trendDirection: string;
  volumeRatio: number;
  breakoutConfirmed: boolean;
  atr: number;
  atrPct: number;
  rangeExpansion: number;
  liquidityScore: number;
  quoteVolume24h: number;
  openInterest: number;
  openInterestNotional: number;
  liquidityPassed: boolean;
  maxSafePositionSize: number;  // max $ position size based on liquidity
  ema20: number; ema50: number; ema200: number;
  reasons: string[];
  passed: boolean;          // passed all minimum thresholds
}

@Injectable()
export class DeepAnalysisService {
  private readonly logger = new Logger(DeepAnalysisService.name);

  // Cache candles per symbol+interval to avoid hammering Binance REST
  private candleCache: Map<string, { data: CandleData[]; fetchedAt: number }> = new Map();
  private openInterestCache: Map<string, { openInterest: number; notional: number; fetchedAt: number }> = new Map();

  // Per-interval TTLs: 1m candles need more frequent refreshes to avoid analysing
  // a half-stale candle; longer intervals can tolerate a wider cache window.
  private readonly CACHE_TTL: Record<string, number> = {
    '1m':  20_000,   // refresh ~3× per minute
    '5m':  60_000,   // refresh once per minute
    '15m': 120_000,  // refresh every 2 minutes
  };
  private readonly CACHE_TTL_DEFAULT = 55_000;

  constructor(
    private readonly config: BotConfigService,
    private readonly scanner: MarketScannerService,
  ) {}

  async analyse(symbol: string, direction: 'LONG' | 'SHORT'): Promise<DeepAnalysisResult> {
    const reasons: string[] = [];

    const [candles1m, candles5m, candles15m] = await Promise.all([
      this.fetchCandles(symbol, '1m', 210),
      this.fetchCandles(symbol, '5m', 100),
      this.fetchCandles(symbol, '15m', 60),
    ]);

    const currentPrice = this.scanner.getCurrentPrice(symbol);
    const cfg = this.config.get();

    // ── Trend Analysis (EMA on 1m) ─────────────────────────────────────────
    const closes1m = candles1m.map(c => c.close);
    const ema20  = this.ema(closes1m, 20);
    const ema50  = this.ema(closes1m, 50);
    const ema200 = this.ema(closes1m, 200);

    let trendScore = 0;
    let trendDirection = 'NEUTRAL';

    if (direction === 'LONG') {
      if (ema20 > ema50 && ema50 > ema200) {
        trendScore = 100;
        trendDirection = 'BULLISH';
        reasons.push('EMA aligned bullish');
      } else if (ema20 > ema50) {
        trendScore = 50;
        trendDirection = 'PARTIAL_BULLISH';
        reasons.push('EMA20 > EMA50 only');
      } else {
        trendScore = 0;
        reasons.push('Trend not bullish');
      }
      if (ema20 < ema50 && ema50 < ema200) {
        reasons.push('WARNING: full bearish EMA stack (EMA20<EMA50<EMA200) — SHORT likely scores higher');
      } else if (currentPrice < ema200) {
        reasons.push(`WARNING: price below EMA200 ($${ema200.toFixed(6)}) — bearish structural bias`);
      }
    } else {
      if (ema20 < ema50 && ema50 < ema200) {
        trendScore = 100;
        trendDirection = 'BEARISH';
        reasons.push('EMA aligned bearish');
      } else if (ema20 < ema50) {
        trendScore = 50;
        trendDirection = 'PARTIAL_BEARISH';
        reasons.push('EMA20 < EMA50 only');
      } else {
        trendScore = 0;
        reasons.push('Trend not bearish');
      }
      if (ema20 > ema50 && ema50 > ema200) {
        reasons.push('WARNING: full bullish EMA stack (EMA20>EMA50>EMA200) — LONG likely scores higher');
      } else if (currentPrice > ema200) {
        reasons.push(`WARNING: price above EMA200 ($${ema200.toFixed(6)}) — bullish structural bias`);
      }
    }

    // ── Volume Analysis (5m candles) ───────────────────────────────────────
    const volumes5m = candles5m.map(c => c.volume);
    const currentVol = volumes5m[volumes5m.length - 1] ?? 0;
    const avgVol = volumes5m.slice(-11, -1).reduce((s, v) => s + v, 0) / 10 || 1;
    const volumeRatio = currentVol / avgVol;

    let volumeScore = 0;
    if (volumeRatio >= 2.5)      volumeScore = 100;
    else if (volumeRatio >= 2.0) volumeScore = 85;
    else if (volumeRatio >= 1.5) volumeScore = 65;
    else if (volumeRatio >= 1.2) volumeScore = 40;
    else if (volumeRatio >= 1.0) volumeScore = 20;  // slightly elevated vs average
    else                         volumeScore = 0;

    if (volumeRatio >= 1.5) reasons.push(`Volume ${volumeRatio.toFixed(2)}x`);
    else reasons.push(`Volume low (${volumeRatio.toFixed(2)}x)`);

    // ── Breakout Analysis (5m candles) ─────────────────────────────────────
    const prev3 = candles5m.slice(-4, -1);
    const highestHigh = Math.max(...prev3.map(c => c.high));
    const lowestLow   = Math.min(...prev3.map(c => c.low));

    // ATR needed early for near-breakout detection (compute on 5m, 14-period)
    const atrEarly = this.calcATR(candles5m, 14);

    let breakoutScore = 0;
    let breakoutConfirmed = false;

    if (direction === 'LONG' && currentPrice > highestHigh) {
      breakoutScore = 100;
      breakoutConfirmed = true;
      reasons.push(`Breakout above $${highestHigh.toFixed(4)}`);
    } else if (direction === 'SHORT' && currentPrice < lowestLow) {
      breakoutScore = 100;
      breakoutConfirmed = true;
      reasons.push(`Breakdown below $${lowestLow.toFixed(4)}`);
    } else if (direction === 'LONG') {
      // Partial credit: price within 0.5× ATR of resistance
      const gap = highestHigh - currentPrice;
      if (gap <= atrEarly * 0.5) {
        breakoutScore = 50;
        reasons.push(`Near breakout — $${gap.toFixed(4)} below resistance`);
      } else if (gap <= atrEarly) {
        breakoutScore = 25;
        reasons.push(`Approaching resistance — $${gap.toFixed(4)} below`);
      } else {
        breakoutScore = 0;
        reasons.push('No breakout confirmed');
      }
    } else {
      // SHORT partial credit
      const gap = currentPrice - lowestLow;
      if (gap <= atrEarly * 0.5) {
        breakoutScore = 50;
        reasons.push(`Near breakdown — $${gap.toFixed(4)} above support`);
      } else if (gap <= atrEarly) {
        breakoutScore = 25;
        reasons.push(`Approaching support — $${gap.toFixed(4)} above`);
      } else {
        breakoutScore = 0;
        reasons.push('No breakout confirmed');
      }
    }

    // ── Candle Structure (last 3 × 5m) ─────────────────────────────────────
    const candleScore = this.analyseCandleStructure(candles5m.slice(-3), direction, reasons);

    // ── ATR / Volatility (14-period on 5m) ─────────────────────────────────
    const atr = atrEarly;  // already computed above for near-breakout detection
    const atrPct = currentPrice > 0 ? (atr / currentPrice) * 100 : 0;
    const rangeExpansion = this.calcRangeExpansion(candles5m);

    // Reject extreme volatility (ATR% > 5% on 5m is dangerous)
    if (atrPct > 5) {
      reasons.push(`High volatility ATR ${atrPct.toFixed(2)}%`);
    }

    if (rangeExpansion > cfg.maxRangeExpansionRatio) {
      reasons.push(`Range expansion ${rangeExpansion.toFixed(2)}x exceeds ${cfg.maxRangeExpansionRatio}x`);
    }

    // ── Liquidity Analysis ─────────────────────────────────────────────────
    const ticker = this.scanner.getTicker(symbol);
    const quoteVolume24h = ticker?.volume24h ?? 0;
    const oi = await this.fetchOpenInterest(symbol, currentPrice);
    // Dynamic position sizing: safe to trade up to 0.1% of 24h volume or 1% of OI notional
    const maxSafePositionSize = Math.min(
      quoteVolume24h * 0.001,
      oi.notional > 0 ? oi.notional * 0.01 : quoteVolume24h * 0.001,
    );
    const liquidityPassed = maxSafePositionSize >= cfg.minPositionSize;
    const liquidityScore = Math.min(
      100,
      Math.min(quoteVolume24h / cfg.minQuoteVolume24h, 1) * 50 +
      Math.min(oi.notional / cfg.minOpenInterestNotional, 1) * 50,
    );

    if (liquidityPassed) {
      reasons.push(`Liquidity OK — max safe size $${maxSafePositionSize.toFixed(0)} (vol=$${quoteVolume24h.toFixed(0)} OI=$${oi.notional.toFixed(0)})`);
    } else {
      reasons.push(`Liquidity too thin — max safe size $${maxSafePositionSize.toFixed(0)} < min $${cfg.minPositionSize}`);
    }

    // ── Minimum pass thresholds ─────────────────────────────────────────────
    const passed =
      (!cfg.requireVolumeGate || volumeRatio >= 1.3) &&
      breakoutConfirmed &&
      atrPct <= 5 &&
      rangeExpansion <= cfg.maxRangeExpansionRatio &&
      liquidityPassed;

    return {
      symbol, direction,
      trendScore, volumeScore, breakoutScore, candleScore,
      trendDirection, volumeRatio, breakoutConfirmed,
      atr, atrPct, rangeExpansion,
      liquidityScore, quoteVolume24h,
      openInterest: oi.openInterest,
      openInterestNotional: oi.notional,
      liquidityPassed,
      maxSafePositionSize,
      ema20, ema50, ema200,
      reasons, passed,
    };
  }

  // ─── Candle Structure ────────────────────────────────────────────────────

  private analyseCandleStructure(
    candles: CandleData[],
    direction: 'LONG' | 'SHORT',
    reasons: string[],
  ): number {
    if (candles.length === 0) return 0;

    let score = 0;
    const last = candles[candles.length - 1];
    const body = Math.abs(last.close - last.open);
    const range = last.high - last.low || 1;
    const bodyRatio = body / range;
    const isBullCandle = last.close > last.open;
    const upperWick = last.high - Math.max(last.open, last.close);
    const lowerWick = Math.min(last.open, last.close) - last.low;

    // Strong candle in direction
    if (direction === 'LONG' && isBullCandle && bodyRatio > 0.6) {
      score += 40;
      reasons.push('Strong bull candle');
    } else if (direction === 'SHORT' && !isBullCandle && bodyRatio > 0.6) {
      score += 40;
      reasons.push('Strong bear candle');
    }

    // Engulfing check (last candle body > previous candle body)
    if (candles.length >= 2) {
      const prev = candles[candles.length - 2];
      const prevBody = Math.abs(prev.close - prev.open);
      if (body > prevBody * 1.5) {
        score += 30;
        reasons.push('Engulfing pattern');
      }
    }

    // Wick analysis
    if (direction === 'LONG' && lowerWick < body * 0.3 && upperWick < body * 0.5) {
      score += 20;
    } else if (direction === 'SHORT' && upperWick < body * 0.3 && lowerWick < body * 0.5) {
      score += 20;
    }

    // Consistent direction over last 3 candles
    if (candles.length === 3) {
      const allBull = candles.every(c => c.close > c.open);
      const allBear = candles.every(c => c.close < c.open);
      if (direction === 'LONG' && allBull) { score += 10; reasons.push('3 consecutive bull candles'); }
      if (direction === 'SHORT' && allBear) { score += 10; reasons.push('3 consecutive bear candles'); }
    }

    return Math.min(score, 100);
  }

  // ─── Indicators ─────────────────────────────────────────────────────────

  private ema(prices: number[], period: number): number {
    if (prices.length === 0) return 0;
    const k = 2 / (period + 1);
    const start = Math.min(period, prices.length);
    let ema = prices.slice(0, start).reduce((a, b) => a + b, 0) / start;
    for (let i = start; i < prices.length; i++) {
      ema = prices[i] * k + ema * (1 - k);
    }
    return ema;
  }

  private calcATR(candles: CandleData[], period: number): number {
    if (candles.length < 2) return 0;
    const trs: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const c = candles[i];
      const prev = candles[i - 1];
      trs.push(Math.max(
        c.high - c.low,
        Math.abs(c.high - prev.close),
        Math.abs(c.low - prev.close),
      ));
    }
    const slice = trs.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  }

  private calcRangeExpansion(candles: CandleData[]): number {
    if (candles.length < 3) return 1;
    const last = candles[candles.length - 1];
    const lastRange = Math.max(last.high - last.low, 0);
    const prior = candles.slice(-11, -1);
    const avgRange = prior.reduce((sum, c) => sum + Math.max(c.high - c.low, 0), 0) / prior.length;
    if (!avgRange) return 1;
    return lastRange / avgRange;
  }

  private async fetchOpenInterest(symbol: string, price: number): Promise<{ openInterest: number; notional: number }> {
    const cached = this.openInterestCache.get(symbol);
    if (cached && Date.now() - cached.fetchedAt < this.CACHE_TTL_DEFAULT) {
      return { openInterest: cached.openInterest, notional: cached.notional };
    }

    try {
      const https = require('https');
      const url = `https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`;
      const raw = await new Promise<string>((resolve, reject) => {
        https.get(url, (res: any) => {
          let d = ''; res.on('data', (c: any) => d += c); res.on('end', () => resolve(d));
        }).on('error', reject);
      });
      const json = JSON.parse(raw);
      const openInterest = parseFloat(json.openInterest) || 0;
      const notional = openInterest * price;
      this.openInterestCache.set(symbol, { openInterest, notional, fetchedAt: Date.now() });
      return { openInterest, notional };
    } catch (err) {
      this.logger.warn(`Failed to fetch ${symbol} open interest: ${err.message}`);
      return cached
        ? { openInterest: cached.openInterest, notional: cached.notional }
        : { openInterest: 0, notional: 0 };
    }
  }

  // ─── Candle Fetcher ──────────────────────────────────────────────────────

  async fetchCandles(symbol: string, interval: string, limit: number): Promise<CandleData[]> {
    const key = `${symbol}:${interval}`;
    const cached = this.candleCache.get(key);
    const ttl = this.CACHE_TTL[interval] ?? this.CACHE_TTL_DEFAULT;
    if (cached && Date.now() - cached.fetchedAt < ttl) {
      return cached.data;
    }

    try {
      const https = require('https');
      const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const raw = await new Promise<string>((resolve, reject) => {
        https.get(url, (res: any) => {
          let d = ''; res.on('data', (c: any) => d += c); res.on('end', () => resolve(d));
        }).on('error', reject);
      });

      const json = JSON.parse(raw);
      const data: CandleData[] = json.map((k: any) => ({
        openTime: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }));

      this.candleCache.set(key, { data, fetchedAt: Date.now() });
      return data;
    } catch (err) {
      this.logger.warn(`Failed to fetch ${symbol} ${interval} candles: ${err.message}`);
      return cached?.data ?? [];
    }
  }
}
