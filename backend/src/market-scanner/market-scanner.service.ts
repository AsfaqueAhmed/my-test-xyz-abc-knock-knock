import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BotConfigService } from '../config/bot-config.service';

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

  private priceHistory: Map<string, PriceSnapshot[]> = new Map();
  private tickers: Map<string, SymbolTicker> = new Map();
  private allSymbols: string[] = [];
  private tokenNames: Map<string, string> = new Map();

  private scanTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private lastUpdate: Date = new Date();
  private scanTurn = 0;

  constructor(
    private readonly config: BotConfigService,
    private readonly events: EventEmitter2,
  ) {}

  async onModuleInit() {
    await this.fetchAllSymbols();
    await this.fetchAndSnapshot();
    this.startScanTimer();
    this.startCleanupTimer();
  }

  onModuleDestroy() {
    if (this.scanTimer) clearInterval(this.scanTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
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

  // ─── Scan Timer (fetch + snapshot) ───────────────────────────────────────

  private startScanTimer() {
    const cfg = this.config.get();
    this.scanTimer = setInterval(() => {
      void this.fetchAndSnapshot();
    }, cfg.scanIntervalMs);
  }

  restartTimers() {
    if (this.scanTimer) clearInterval(this.scanTimer);
    this.startScanTimer();
    this.logger.log('Scanner timer restarted with updated config');
  }

  private async fetchAndSnapshot() {
    await this.fetchTickerSnapshot();
    this.takeSnapshot();
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
    } catch (err) {
      this.logger.warn(`Could not refresh ticker snapshot: ${err.message}`);
    }
  }

  private takeSnapshot() {
    const now = Date.now();
    this.scanTurn++;

    for (const [symbol, ticker] of this.tickers) {
      const history = this.priceHistory.get(symbol) || [];
      history.push({ timestamp: now, price: ticker.price });
      this.priceHistory.set(symbol, history);
    }

    this.events.emit('scanner.tick', { turn: this.scanTurn, timestamp: now });
  }

  // ─── Cleanup Timer ────────────────────────────────────────────────────────

  private startCleanupTimer() {
    this.cleanupTimer = setInterval(() => {
      const cfg = this.config.get();
      const cutoff = Date.now() - cfg.priceHistoryHours * 60 * 60 * 1000;
      for (const [symbol, history] of this.priceHistory) {
        const pruned = history.filter(s => s.timestamp >= cutoff);
        this.priceHistory.set(symbol, pruned);
      }
    }, 60_000);
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  getPriceAt(symbol: string, targetMs: number): number | null {
    const history = this.priceHistory.get(symbol);
    if (!history || history.length === 0) return null;
    let best: PriceSnapshot | null = null;
    for (const snap of history) {
      if (snap.timestamp > targetMs) break;
      best = snap;
    }
    return best?.price ?? null;
  }

  getPriceByIndex(symbol: string, stepsBack: number): number | null {
    const history = this.priceHistory.get(symbol);
    if (!history || history.length === 0) return null;
    const idx = history.length - 1 - stepsBack;
    return idx >= 0 ? history[idx].price : null;
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

  isConnected(): boolean { return this.tickers.size > 0; }
  getLastUpdate(): Date { return this.lastUpdate; }
  getScanTurn(): number { return this.scanTurn; }
  getSymbolCount(): number { return this.allSymbols.length; }

  private deriveTokenName(symbol: string): string {
    return symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol;
  }
}
