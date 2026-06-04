import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BotConfigService } from '../config/bot-config.service';
import WebSocket = require('ws');

export interface PriceSnapshot {
  timestamp: number;
  price: number;
}

export interface SymbolTicker {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
  openInterest?: number;
  updatedAt: number;
}

@Injectable()
export class MarketScannerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MarketScannerService.name);

  // symbol -> array of price snapshots (rolling 2h)
  private priceHistory: Map<string, PriceSnapshot[]> = new Map();

  // symbol -> latest ticker data
  private tickers: Map<string, SymbolTicker> = new Map();

  // all known USDT perp symbols (fetched from Binance on startup)
  private allSymbols: string[] = [];

  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private snapshotTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private isDestroyed = false;
  private wsConnected = false;
  private lastUpdate: Date = new Date();
  private scanTurn = 0; // incremented every snapshot interval

  constructor(
    private readonly config: BotConfigService,
    private readonly events: EventEmitter2,
  ) {}

  async onModuleInit() {
    await this.fetchAllSymbols();
    this.connectWebSocket();
    this.startSnapshotTimer();
    this.startCleanupTimer();
  }

  onModuleDestroy() {
    this.isDestroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.snapshotTimer) clearInterval(this.snapshotTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    if (this.ws) try { this.ws.terminate(); } catch (_) {}
  }

  // ─── Symbol Discovery ─────────────────────────────────────────────────────

  private async fetchAllSymbols() {
    try {
      const https = require('https');
      const data = await new Promise<string>((resolve, reject) => {
        https.get('https://fapi.binance.com/fapi/v1/exchangeInfo', (res: any) => {
          let d = '';
          res.on('data', (c: any) => d += c);
          res.on('end', () => resolve(d));
        }).on('error', reject);
      });
      const json = JSON.parse(data);
      this.allSymbols = json.symbols
        .filter((s: any) =>
          s.quoteAsset === 'USDT' &&
          s.status === 'TRADING' &&
          s.contractType === 'PERPETUAL'
        )
        .map((s: any) => s.symbol)
        .sort();
      this.logger.log(`Discovered ${this.allSymbols.length} active USDT perpetuals`);
    } catch (err) {
      this.logger.warn(`Could not fetch symbols from Binance: ${err.message}. Using fallback.`);
      this.allSymbols = [
        'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','AVAXUSDT',
        'LINKUSDT','DOTUSDT','LTCUSDT','ARBUSDT','OPUSDT','INJUSDT','SUIUSDT','PEPEUSDT',
        'WLDUSDT','TIAUSDT','TONUSDT','FETUSDT','RENDERUSDT','JUPUSDT','PYTHUSDT',
        'STRKUSDT','ENAUSDT','EIGENUSDT','ONDOUSDT','MOVEUSDT','MEUSDT','TRUMPUSDT',
      ];
    }

    // Initialise price history buckets for all symbols
    for (const sym of this.allSymbols) {
      if (!this.priceHistory.has(sym)) this.priceHistory.set(sym, []);
    }
  }

  // ─── WebSocket ────────────────────────────────────────────────────────────

  private connectWebSocket() {
    if (this.isDestroyed) return;

    // Single stream — receives ALL symbol tickers every ~1s
    const url = 'wss://fstream.binance.com/ws/!miniTicker@arr';
    this.logger.log('Connecting to Binance !miniTicker@arr stream...');

    try {
      this.ws = new WebSocket(url);

      this.ws.on('open', () => {
        this.wsConnected = true;
        this.lastUpdate = new Date();
        this.logger.log('Market scanner WebSocket connected');
      });

      this.ws.on('message', (data: Buffer) => {
        try {
          const tickers = JSON.parse(data.toString());
          this.processTickers(tickers);
          this.lastUpdate = new Date();
        } catch (_) {}
      });

      this.ws.on('close', () => {
        this.wsConnected = false;
        this.logger.warn('Scanner WS disconnected, reconnecting in 3s...');
        if (!this.isDestroyed) {
          this.reconnectTimer = setTimeout(() => this.connectWebSocket(), 3000);
        }
      });

      this.ws.on('error', (err: Error) => {
        this.logger.warn(`Scanner WS error: ${err.message}`);
        this.wsConnected = false;
      });

      // Ping to keep alive
      setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.ping();
      }, 20000);

    } catch (err) {
      this.logger.warn(`Scanner WS failed: ${err.message}`);
      if (!this.isDestroyed) {
        this.reconnectTimer = setTimeout(() => this.connectWebSocket(), 5000);
      }
    }
  }

  private processTickers(tickers: any[]) {
    for (const t of tickers) {
      // miniTicker format: e=24hrMiniTicker, s=symbol, c=close, v=volume, q=quoteVolume
      if (!t.s || !t.s.endsWith('USDT')) continue;
      const price = parseFloat(t.c);
      if (!price || isNaN(price)) continue;

      this.tickers.set(t.s, {
        symbol: t.s,
        price,
        change24h: 0, // miniTicker doesn't give 24h pct — calculated separately
        volume24h: parseFloat(t.q) || 0,
        updatedAt: Date.now(),
      });

      // Add to allSymbols if newly seen
      if (!this.allSymbols.includes(t.s)) {
        this.allSymbols.push(t.s);
        this.priceHistory.set(t.s, []);
        this.logger.log(`New symbol discovered: ${t.s}`);
      }
    }
  }

  // ─── Snapshot Timer ───────────────────────────────────────────────────────

  private startSnapshotTimer() {
    const cfg = this.config.get();
    this.snapshotTimer = setInterval(() => {
      this.takeSnapshot();
    }, cfg.scanIntervalMs);
  }

  private takeSnapshot() {
    const now = Date.now();
    this.scanTurn++;

    for (const [symbol, ticker] of this.tickers) {
      const history = this.priceHistory.get(symbol) || [];
      history.push({ timestamp: now, price: ticker.price });
      this.priceHistory.set(symbol, history);
    }

    // Emit scan tick so momentum ranker can process
    this.events.emit('scanner.tick', { turn: this.scanTurn, timestamp: now });
  }

  // ─── Cleanup Timer ────────────────────────────────────────────────────────

  private startCleanupTimer() {
    // Prune old price history every minute
    this.cleanupTimer = setInterval(() => {
      const cfg = this.config.get();
      const cutoff = Date.now() - cfg.priceHistoryHours * 60 * 60 * 1000;
      for (const [symbol, history] of this.priceHistory) {
        const pruned = history.filter(s => s.timestamp >= cutoff);
        this.priceHistory.set(symbol, pruned);
      }
    }, 60_000);
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  getPriceAt(symbol: string, targetMs: number): number | null {
    const history = this.priceHistory.get(symbol);
    if (!history || history.length === 0) return null;
    // Find the snapshot closest to targetMs (but not after it)
    let best: PriceSnapshot | null = null;
    for (const snap of history) {
      if (snap.timestamp <= targetMs) best = snap;
      else break;
    }
    return best?.price ?? null;
  }

  getCurrentPrice(symbol: string): number {
    return this.tickers.get(symbol)?.price ?? 0;
  }

  getAllTickers(): SymbolTicker[] {
    return Array.from(this.tickers.values());
  }

  getTicker(symbol: string): SymbolTicker | null {
    return this.tickers.get(symbol) ?? null;
  }

  getAllSymbols(): string[] {
    return [...this.allSymbols];
  }

  getPriceHistory(symbol: string): PriceSnapshot[] {
    return this.priceHistory.get(symbol) ?? [];
  }

  isConnected(): boolean { return this.wsConnected; }
  getLastUpdate(): Date { return this.lastUpdate; }
  getScanTurn(): number { return this.scanTurn; }
  getSymbolCount(): number { return this.allSymbols.length; }
}
