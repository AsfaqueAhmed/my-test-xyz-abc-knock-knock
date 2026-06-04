import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import WebSocket = require('ws');
import { PrismaService } from '../prisma/prisma.service';

export interface Candle {
  symbol: string;
  timeframe: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openTime: Date;
  closeTime: Date;
  isClosed: boolean;
}

export interface Ticker {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
  timestamp: Date;
}

@Injectable()
export class MarketDataService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MarketDataService.name);
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private isDestroyed = false;

  // In-memory candle storage: symbol -> timeframe -> candles[]
  private candleCache: Map<string, Map<string, Candle[]>> = new Map();
  private tickerCache: Map<string, Ticker> = new Map();
  private lastUpdate: Date = new Date();
  private wsConnected = false;

  // Aggregate from kline data
  private rawCandles: Map<string, Candle[]> = new Map(); // symbol -> 1m candles

  readonly SYMBOLS = [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
    'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'MATICUSDT',
  ];

  readonly TIMEFRAMES = ['30s', '1m', '2m', '5m', '10m', '15m', '30m'];
  readonly TIMEFRAME_MS: Record<string, number> = {
    '30s': 30000,
    '1m': 60000,
    '2m': 120000,
    '5m': 300000,
    '10m': 600000,
    '15m': 900000,
    '30m': 1800000,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {}

  async onModuleInit() {
    this.initializeCaches();
    await this.loadHistoricalCandles();
    this.connectWebSocket();
  }

  onModuleDestroy() {
    this.isDestroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.ws) this.ws.terminate();
  }

  private initializeCaches() {
    for (const symbol of this.SYMBOLS) {
      this.candleCache.set(symbol, new Map());
      this.rawCandles.set(symbol, []);
      for (const tf of this.TIMEFRAMES) {
        this.candleCache.get(symbol)!.set(tf, []);
      }
    }
  }

  private async loadHistoricalCandles() {
    try {
      // Load 1m candles from Binance REST API
      for (const symbol of this.SYMBOLS) {
        await this.fetchHistoricalKlines(symbol, '1m', 200);
        await new Promise(r => setTimeout(r, 100)); // rate limit
      }
      this.logger.log('Historical candles loaded');
    } catch (err) {
      this.logger.warn('Could not load historical candles: ' + err.message);
    }
  }

  private async fetchHistoricalKlines(symbol: string, interval: string, limit: number) {
    try {
      const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json() as any[];
      
      const candles: Candle[] = data.map(k => ({
        symbol,
        timeframe: '1m',
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
        openTime: new Date(k[0]),
        closeTime: new Date(k[6]),
        isClosed: true,
      }));

      this.rawCandles.set(symbol, candles);
      this.aggregateAllTimeframes(symbol);
      
      // Update ticker
      if (candles.length > 0) {
        const last = candles[candles.length - 1];
        this.tickerCache.set(symbol, {
          symbol,
          price: last.close,
          change24h: 0,
          volume24h: 0,
          timestamp: new Date(),
        });
      }
    } catch (err) {
      this.logger.debug(`Failed to fetch klines for ${symbol}: ${err.message}`);
    }
  }

  private connectWebSocket() {
    if (this.isDestroyed) return;

    const streams = this.SYMBOLS.map(s => `${s.toLowerCase()}@kline_1m`).join('/');
    const tickerStreams = this.SYMBOLS.map(s => `${s.toLowerCase()}@ticker`).join('/');
    const url = `wss://fstream.binance.com/stream?streams=${streams}/${tickerStreams}`;

    this.logger.log('Connecting to Binance WebSocket...');
    
    try {
      this.ws = new WebSocket(url);

      this.ws.on('open', () => {
        this.wsConnected = true;
        this.lastUpdate = new Date();
        this.logger.log('Binance WebSocket connected');
        
        this.pingTimer = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.ping();
          }
        }, 30000);
      });

      this.ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleMessage(msg);
          this.lastUpdate = new Date();
        } catch (err) {
          // ignore parse errors
        }
      });

      this.ws.on('close', () => {
        this.wsConnected = false;
        this.logger.warn('WebSocket disconnected, reconnecting...');
        if (this.pingTimer) clearInterval(this.pingTimer);
        if (!this.isDestroyed) {
          this.reconnectTimer = setTimeout(() => this.connectWebSocket(), 5000);
        }
      });

      this.ws.on('error', (err) => {
        this.logger.warn(`WebSocket error: ${err.message}`);
        this.wsConnected = false;
      });
    } catch (err) {
      this.logger.warn(`Failed to connect WebSocket: ${err.message}`);
      if (!this.isDestroyed) {
        this.reconnectTimer = setTimeout(() => this.connectWebSocket(), 10000);
      }
    }
  }

  private handleMessage(msg: any) {
    if (!msg.data) return;
    const { e: eventType, s: symbol } = msg.data;

    if (eventType === 'kline') {
      const k = msg.data.k;
      const candle: Candle = {
        symbol,
        timeframe: '1m',
        open: parseFloat(k.o),
        high: parseFloat(k.h),
        low: parseFloat(k.l),
        close: parseFloat(k.c),
        volume: parseFloat(k.v),
        openTime: new Date(k.t),
        closeTime: new Date(k.T),
        isClosed: k.x,
      };

      const raw = this.rawCandles.get(symbol) || [];
      const lastIdx = raw.findIndex(c => c.openTime.getTime() === candle.openTime.getTime());
      
      if (lastIdx >= 0) {
        raw[lastIdx] = candle;
      } else {
        raw.push(candle);
        if (raw.length > 500) raw.shift();
      }
      this.rawCandles.set(symbol, raw);
      this.aggregateAllTimeframes(symbol);

      if (candle.isClosed) {
        this.persistCandle(candle);
        this.events.emit('candle.closed', candle);
      }

      // Update ticker price
      const ticker = this.tickerCache.get(symbol);
      if (ticker) {
        ticker.price = candle.close;
        ticker.timestamp = new Date();
      }

      this.events.emit('candle.update', candle);
    } else if (eventType === '24hrTicker') {
      const ticker: Ticker = {
        symbol,
        price: parseFloat(msg.data.c),
        change24h: parseFloat(msg.data.P),
        volume24h: parseFloat(msg.data.q),
        timestamp: new Date(),
      };
      this.tickerCache.set(symbol, ticker);
      this.events.emit('ticker.update', ticker);
    }
  }

  private aggregateAllTimeframes(symbol: string) {
    const raw = this.rawCandles.get(symbol) || [];
    const cache = this.candleCache.get(symbol);
    if (!cache) return;

    for (const tf of this.TIMEFRAMES) {
      if (tf === '1m') {
        cache.set('1m', [...raw]);
        continue;
      }
      cache.set(tf, this.aggregateCandles(raw, tf));
    }
  }

  private aggregateCandles(candles1m: Candle[], timeframe: string): Candle[] {
    const ms = this.TIMEFRAME_MS[timeframe];
    if (!ms) return [];

    const buckets = new Map<number, Candle[]>();
    
    for (const c of candles1m) {
      const bucketTime = Math.floor(c.openTime.getTime() / ms) * ms;
      if (!buckets.has(bucketTime)) buckets.set(bucketTime, []);
      buckets.get(bucketTime)!.push(c);
    }

    const result: Candle[] = [];
    const sortedKeys = Array.from(buckets.keys()).sort();
    
    for (const key of sortedKeys) {
      const group = buckets.get(key)!;
      if (group.length === 0) continue;
      
      result.push({
        symbol: group[0].symbol,
        timeframe,
        open: group[0].open,
        high: Math.max(...group.map(c => c.high)),
        low: Math.min(...group.map(c => c.low)),
        close: group[group.length - 1].close,
        volume: group.reduce((s, c) => s + c.volume, 0),
        openTime: new Date(key),
        closeTime: group[group.length - 1].closeTime,
        isClosed: group[group.length - 1].isClosed,
      });
    }

    return result;
  }

  private async persistCandle(candle: Candle) {
    try {
      await this.prisma.candle.upsert({
        where: {
          symbol_timeframe_openTime: {
            symbol: candle.symbol,
            timeframe: candle.timeframe,
            openTime: candle.openTime,
          },
        },
        update: {
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
          closeTime: candle.closeTime,
        },
        create: {
          symbol: candle.symbol,
          timeframe: candle.timeframe,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
          openTime: candle.openTime,
          closeTime: candle.closeTime,
        },
      });
    } catch (err) {
      // ignore duplicate key errors
    }
  }

  getCandles(symbol: string, timeframe: string, limit = 100): Candle[] {
    const cache = this.candleCache.get(symbol);
    if (!cache) return [];
    const candles = cache.get(timeframe) || [];
    return candles.slice(-limit);
  }

  getTicker(symbol: string): Ticker | null {
    return this.tickerCache.get(symbol) || null;
  }

  getAllTickers(): Ticker[] {
    return Array.from(this.tickerCache.values());
  }

  getLastPrice(symbol: string): number {
    const ticker = this.tickerCache.get(symbol);
    if (ticker) return ticker.price;
    const candles = this.getCandles(symbol, '1m', 1);
    return candles.length > 0 ? candles[candles.length - 1].close : 0;
  }

  isWsConnected(): boolean {
    return this.wsConnected;
  }

  getLastUpdate(): Date {
    return this.lastUpdate;
  }
}
