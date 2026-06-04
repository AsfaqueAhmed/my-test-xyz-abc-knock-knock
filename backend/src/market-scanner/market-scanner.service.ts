import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BotConfigService } from '../config/bot-config.service';
import WebSocket = require('ws');

export interface PriceSnapshot {
  timestamp: number;
  price: number;
}

export interface SymbolTicker {
  name: string;
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
  private tokenNames: Map<string, string> = new Map();

  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private symbolRefreshTimer: NodeJS.Timeout | null = null;
  private tickerSnapshotTimer: NodeJS.Timeout | null = null;
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
    await this.fetchTickerSnapshot();
    this.connectWebSocket();
    this.startSymbolRefreshTimer();
    this.startTickerSnapshotTimer();
    this.startSnapshotTimer();
    this.startCleanupTimer();
  }

  onModuleDestroy() {
    this.isDestroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.symbolRefreshTimer) clearInterval(this.symbolRefreshTimer);
    if (this.tickerSnapshotTimer) clearInterval(this.tickerSnapshotTimer);
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
      const symbols = json.symbols
        .filter((s: any) =>
          s.quoteAsset === 'USDT' &&
          s.status === 'TRADING' &&
          s.contractType === 'PERPETUAL'
        );
      this.applySymbolList(symbols.map((s: any) => ({
        symbol: s.symbol,
        baseAsset: s.baseAsset || this.deriveTokenName(s.symbol),
      })));
    } catch (err) {
      if (this.allSymbols.length > 0) {
        this.logger.warn(`Could not refresh symbols from Binance: ${err.message}. Keeping existing list.`);
        return;
      }
      this.logger.warn(`Could not fetch symbols from Binance: ${err.message}. Using fallback.`);
      this.applySymbolList([
        'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','AVAXUSDT',
        'LINKUSDT','DOTUSDT','LTCUSDT','ARBUSDT','OPUSDT','INJUSDT','SUIUSDT','PEPEUSDT',
        'WLDUSDT','TIAUSDT','TONUSDT','FETUSDT','RENDERUSDT','JUPUSDT','PYTHUSDT',
        'STRKUSDT','ENAUSDT','EIGENUSDT','ONDOUSDT','MOVEUSDT','MEUSDT','TRUMPUSDT',
      ].map(symbol => ({ symbol, baseAsset: this.deriveTokenName(symbol) })));
    }
  }

  private applySymbolList(symbols: { symbol: string; baseAsset: string }[]) {
    const previous = new Set(this.allSymbols);
    const next = new Set(symbols.map(s => s.symbol));

    this.allSymbols = symbols.map(s => s.symbol).sort();

    for (const { symbol, baseAsset } of symbols) {
      this.tokenNames.set(symbol, baseAsset);
      if (!this.priceHistory.has(symbol)) this.priceHistory.set(symbol, []);
      if (!previous.has(symbol)) this.logger.log(`Futures symbol listed: ${symbol}`);
    }

    for (const symbol of previous) {
      if (!next.has(symbol)) {
        this.tokenNames.delete(symbol);
        this.priceHistory.delete(symbol);
        this.tickers.delete(symbol);
        this.logger.warn(`Futures symbol removed: ${symbol}`);
      }
    }

    this.logger.log(`Active USDT perpetuals: ${this.allSymbols.length}`);
  }

  private startSymbolRefreshTimer() {
    const cfg = this.config.get();
    this.symbolRefreshTimer = setInterval(() => {
      void this.fetchAllSymbols();
    }, cfg.symbolRefreshIntervalMs);
  }

  private async fetchTickerSnapshot() {
    try {
      const https = require('https');
      const data = await new Promise<string>((resolve, reject) => {
        https.get('https://fapi.binance.com/fapi/v1/ticker/24hr', (res: any) => {
          let d = '';
          res.on('data', (c: any) => d += c);
          res.on('end', () => resolve(d));
        }).on('error', reject);
      });
      const json = JSON.parse(data);
      if (!Array.isArray(json)) return;

      const known = new Set(this.allSymbols);
      for (const t of json) {
        if (!t.symbol || !known.has(t.symbol)) continue;
        const price = parseFloat(t.lastPrice);
        if (!price || isNaN(price)) continue;
        this.tickers.set(t.symbol, {
          name: this.getTokenName(t.symbol),
          symbol: t.symbol,
          price,
          change24h: parseFloat(t.priceChangePercent) || 0,
          volume24h: parseFloat(t.quoteVolume) || 0,
          updatedAt: Date.now(),
        });
      }
      this.lastUpdate = new Date();
      this.logger.log(`Ticker snapshot refreshed: ${this.tickers.size} symbols`);
    } catch (err) {
      this.logger.warn(`Could not refresh ticker snapshot: ${err.message}`);
    }
  }

  private startTickerSnapshotTimer() {
    const cfg = this.config.get();
    this.tickerSnapshotTimer = setInterval(() => {
      void this.fetchTickerSnapshot();
    }, cfg.tickerSnapshotIntervalMs);
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
      // miniTicker format includes s=symbol, c=close, o=24h open, v=volume, q=quoteVolume
      if (!t.s || !t.s.endsWith('USDT')) continue;
      const price = parseFloat(t.c);
      if (!price || isNaN(price)) continue;
      const open24h = parseFloat(t.o);
      const change24h = open24h > 0 ? ((price - open24h) / open24h) * 100 : 0;

      this.tickers.set(t.s, {
        name: this.getTokenName(t.s),
        symbol: t.s,
        price,
        change24h,
        volume24h: parseFloat(t.q) || 0,
        updatedAt: Date.now(),
      });

      // Add to allSymbols if newly seen
      if (!this.allSymbols.includes(t.s)) {
        this.allSymbols.push(t.s);
        this.tokenNames.set(t.s, this.deriveTokenName(t.s));
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

  getTokenName(symbol: string): string {
    return this.tokenNames.get(symbol) ?? this.deriveTokenName(symbol);
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

  private deriveTokenName(symbol: string): string {
    return symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol;
  }
}
