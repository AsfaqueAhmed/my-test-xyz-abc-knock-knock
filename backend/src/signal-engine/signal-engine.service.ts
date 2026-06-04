import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { MarketDataService, Candle } from '../market-data/market-data.service';
import { IndicatorsService } from '../indicators/indicators.service';
import { BotConfigService } from '../config/bot-config.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface SignalResult {
  symbol: string;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  momentumScore: number;
  confidence: number;
  trendDirection: string;
  volumeRatio: number;
  breakoutType: string | null;
  reasons: string[];
  valid: boolean;
}

@Injectable()
export class SignalEngineService {
  private readonly logger = new Logger(SignalEngineService.name);
  private lastSignalTime: Map<string, number> = new Map();
  private processingSignals = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly marketData: MarketDataService,
    private readonly indicators: IndicatorsService,
    private readonly botConfig: BotConfigService,
    private readonly events: EventEmitter2,
  ) {}

  @OnEvent('candle.closed')
  async onCandleClosed(candle: Candle) {
    if (this.processingSignals) return;
    this.processingSignals = true;
    try {
      await this.analyzeSymbol(candle.symbol);
    } finally {
      this.processingSignals = false;
    }
  }

  async analyzeSymbol(symbol: string): Promise<SignalResult> {
    const config = this.botConfig.get();
    const currentPrice = this.marketData.getLastPrice(symbol);
    
    if (currentPrice === 0) {
      return this.neutralSignal(symbol, 'No price data');
    }

    // Get candles for all timeframes
    const candlesByTf: Record<string, Candle[]> = {};
    for (const tf of this.marketData.TIMEFRAMES) {
      candlesByTf[tf] = this.marketData.getCandles(symbol, tf, 210);
    }

    // Calculate indicators
    const momentum = this.indicators.calculateMomentum(candlesByTf, currentPrice);
    const trend = this.indicators.calculateTrend(candlesByTf['1m'] || []);
    const volume = this.indicators.calculateVolume(candlesByTf['1m'] || []);
    const breakout = this.indicators.calculateBreakout(candlesByTf['1m'] || [], currentPrice);

    const reasons: string[] = [];
    let direction: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
    let valid = false;

    const absScore = Math.abs(momentum.score);
    
    if (
      momentum.direction === 'BULLISH' &&
      trend.direction === 'BULLISH' &&
      volume.confirmed &&
      breakout.type === 'BULLISH' &&
      absScore >= config.momentumThreshold
    ) {
      direction = 'LONG';
      valid = true;
      reasons.push('Bullish momentum', 'Bullish trend', 'Volume confirmed', 'Breakout confirmed');
    } else if (
      momentum.direction === 'BEARISH' &&
      trend.direction === 'BEARISH' &&
      volume.confirmed &&
      breakout.type === 'BEARISH' &&
      absScore >= config.momentumThreshold
    ) {
      direction = 'SHORT';
      valid = true;
      reasons.push('Bearish momentum', 'Bearish trend', 'Volume confirmed', 'Breakdown confirmed');
    } else {
      // Collect partial reasons
      if (momentum.direction !== 'NEUTRAL') reasons.push(`Momentum: ${momentum.direction}`);
      if (trend.direction !== 'NEUTRAL') reasons.push(`Trend: ${trend.direction}`);
      if (!volume.confirmed) reasons.push(`Volume low (${volume.ratio.toFixed(2)}x)`);
      if (!breakout.confirmed) reasons.push('No breakout');
    }

    const signal: SignalResult = {
      symbol,
      direction,
      momentumScore: momentum.score,
      confidence: momentum.confidence,
      trendDirection: trend.direction,
      volumeRatio: volume.ratio,
      breakoutType: breakout.type,
      reasons,
      valid,
    };

    // Persist signal
    if (valid) {
      try {
        const saved = await this.prisma.signal.create({
          data: {
            symbol,
            direction,
            momentumScore: momentum.score,
            confidence: momentum.confidence,
            trendDirection: trend.direction,
            volumeRatio: volume.ratio,
            breakoutType: breakout.type,
          },
        });
        signal['id'] = saved.id.toString();
        this.events.emit('signal.generated', signal);
        this.logger.log(`Signal: ${symbol} ${direction} score=${momentum.score.toFixed(3)}`);
      } catch (err) {
        this.logger.error('Failed to save signal: ' + err.message);
      }
    }

    return signal;
  }

  async analyzeAll(): Promise<SignalResult[]> {
    const config = this.botConfig.get();
    const results: SignalResult[] = [];
    for (const symbol of config.symbols) {
      const result = await this.analyzeSymbol(symbol);
      results.push(result);
    }
    return results;
  }

  async getLatestSignals(limit = 50) {
    return this.prisma.signal.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  private neutralSignal(symbol: string, reason: string): SignalResult {
    return {
      symbol,
      direction: 'NEUTRAL',
      momentumScore: 0,
      confidence: 0,
      trendDirection: 'NEUTRAL',
      volumeRatio: 0,
      breakoutType: null,
      reasons: [reason],
      valid: false,
    };
  }
}
