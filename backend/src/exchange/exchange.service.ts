import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as https from 'https';
import * as crypto from 'crypto';
import { BotConfigService } from '../config/bot-config.service';

export interface ExchangeOrderResult {
  orderId: number;
  symbol: string;
  side: string;
  executedQty: number;
  avgPrice: number;
  status: string;
}

export interface SymbolFilters {
  stepSize: number;         // LOT_SIZE step — quantity must be a multiple of this
  minQty: number;           // minimum quantity per order
  maxMarketQty: number;     // maximum quantity for a single market order (MARKET_LOT_SIZE)
  minNotional: number;      // minimum order value in USDT (price × quantity)
  quantityPrecision: number; // decimal places for formatting
}

@Injectable()
export class ExchangeService implements OnModuleInit {
  private readonly logger = new Logger(ExchangeService.name);

  // Symbol filter cache: invalidated when testnet flag changes
  private filters = new Map<string, SymbolFilters>();
  private filtersLoadedForTestnet: boolean | null = null;

  constructor(private readonly botConfig: BotConfigService) {}

  async onModuleInit() {
    // Always load filters — needed for minNotional checks in paper mode too
    await this.loadFilters();
    const cfg = this.botConfig.get();
    if (this.isConfigured()) {
      this.logger.log(
        `Exchange client ready (${cfg.binanceTestnet ? 'TESTNET' : 'MAINNET'}), ` +
        `${this.filters.size} symbols loaded`
      );
    } else {
      this.logger.log(`Symbol filters loaded (${this.filters.size} symbols) — live trading disabled (no API keys)`);
    }
  }

  isConfigured(): boolean {
    const { binanceApiKey, binanceApiSecret } = this.botConfig.get();
    return !!(binanceApiKey && binanceApiSecret);
  }

  // ─── Public filter accessors ──────────────────────────────────────────────

  getSymbolFilters(symbol: string): SymbolFilters {
    return this.filters.get(symbol) ?? { stepSize: 0.001, minQty: 0.001, maxMarketQty: 1000, minNotional: 5, quantityPrecision: 3 };
  }

  getMinNotional(symbol: string): number {
    return this.filters.get(symbol)?.minNotional ?? 5;
  }

  /**
   * Floors quantity to the symbol's step size, capping at MARKET_LOT_SIZE maxQty.
   * Returns null if the result is below minQty (trade should be blocked).
   * Returns { quantity, capped } — capped=true means capital was partially used.
   */
  floorQuantity(symbol: string, qty: number): { quantity: number; capped: boolean } | null {
    const f = this.getSymbolFilters(symbol);
    const capped = qty > f.maxMarketQty;
    const adjusted = capped ? f.maxMarketQty : qty;
    // Floor to step size using integer arithmetic to avoid floating-point drift
    const steps = Math.floor(adjusted / f.stepSize);
    const floored = steps * f.stepSize;
    if (floored < f.minQty) return null;
    return { quantity: floored, capped };
  }

  /**
   * Validates that a proposed order meets Binance's size requirements.
   * Returns an error string, or null if the order is valid.
   */
  validateOrder(symbol: string, quantity: number, price: number): string | null {
    const f = this.getSymbolFilters(symbol);
    if (quantity < f.minQty) {
      return `Quantity ${quantity} below minQty ${f.minQty} for ${symbol}`;
    }
    if (quantity > f.maxMarketQty) {
      return `Quantity ${quantity} exceeds market maxQty ${f.maxMarketQty} for ${symbol}`;
    }
    const notional = quantity * price;
    if (notional < f.minNotional) {
      return `Order notional $${notional.toFixed(2)} below minimum $${f.minNotional} for ${symbol}`;
    }
    return null;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  async placeMarketOrder(
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number,
    reduceOnly = false,
  ): Promise<ExchangeOrderResult> {
    await this.ensureFilters();
    const qty = this.formatQuantity(symbol, quantity);
    const params: Record<string, string | number> = {
      symbol,
      side,
      type: 'MARKET',
      quantity: qty,
      timestamp: Date.now(),
    };
    if (reduceOnly) params.reduceOnly = 'true';

    const raw = await this.signedRequest('POST', '/fapi/v1/order', params);
    return {
      orderId:     raw.orderId,
      symbol:      raw.symbol,
      side:        raw.side,
      executedQty: parseFloat(raw.executedQty ?? qty),
      avgPrice:    parseFloat(raw.avgPrice ?? raw.price ?? '0'),
      status:      raw.status,
    };
  }

  async getAvailableBalance(): Promise<number> {
    const raw = await this.signedRequest('GET', '/fapi/v2/account', { timestamp: Date.now() });
    const usdt = (raw.assets as any[]).find((a: any) => a.asset === 'USDT');
    return usdt ? parseFloat(usdt.availableBalance) : 0;
  }

  async setLeverage(symbol: string, leverage: number): Promise<void> {
    await this.signedRequest('POST', '/fapi/v1/leverage', { symbol, leverage, timestamp: Date.now() });
  }

  // ─── Filter cache ─────────────────────────────────────────────────────────

  private async ensureFilters() {
    const { binanceTestnet } = this.botConfig.get();
    if (this.filtersLoadedForTestnet !== binanceTestnet) {
      await this.loadFilters();
    }
  }

  private async loadFilters() {
    const { binanceTestnet } = this.botConfig.get();
    try {
      const raw = await this.publicRequest('GET', '/fapi/v1/exchangeInfo', {});
      this.filters.clear();
      for (const s of (raw.symbols as any[])) {
        if (s.quoteAsset !== 'USDT' || s.contractType !== 'PERPETUAL') continue;

        let stepSize = Math.pow(10, -(s.quantityPrecision ?? 3));
        let minQty = stepSize;
        let maxMarketQty = Infinity;
        let minNotional = 5;

        for (const f of (s.filters as any[])) {
          if (f.filterType === 'LOT_SIZE') {
            stepSize = parseFloat(f.stepSize);
            minQty   = parseFloat(f.minQty);
          }
          if (f.filterType === 'MARKET_LOT_SIZE') {
            maxMarketQty = parseFloat(f.maxQty);
          }
          if (f.filterType === 'MIN_NOTIONAL') {
            minNotional = parseFloat(f.notional);
          }
        }

        this.filters.set(s.symbol, {
          stepSize,
          minQty,
          maxMarketQty,
          minNotional,
          quantityPrecision: s.quantityPrecision ?? 3,
        });
      }
      this.filtersLoadedForTestnet = binanceTestnet;
    } catch (err) {
      this.logger.warn(`Could not load symbol filters: ${err.message}`);
    }
  }

  // Floor to step size (never round up — avoids over-spending capital).
  // Uses decimal string arithmetic to sidestep floating-point precision issues.
  private formatQuantity(symbol: string, qty: number): string {
    const f = this.getSymbolFilters(symbol);
    const steps = Math.floor(qty / f.stepSize);
    const floored = steps * f.stepSize;
    return floored.toFixed(f.quantityPrecision);
  }

  // ─── Request helpers ──────────────────────────────────────────────────────

  private get apiKey(): string    { return this.botConfig.get().binanceApiKey; }
  private get apiSecret(): string { return this.botConfig.get().binanceApiSecret; }
  private get baseUrl(): string {
    return this.botConfig.get().binanceTestnet
      ? 'https://testnet.binancefuture.com'
      : 'https://fapi.binance.com';
  }

  private sign(params: Record<string, string | number>): string {
    const qs = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)])
    ).toString();
    return crypto.createHmac('sha256', this.apiSecret).update(qs).digest('hex');
  }

  private buildQs(params: Record<string, string | number>): string {
    return new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)])
    ).toString();
  }

  private async signedRequest(
    method: 'GET' | 'POST',
    path: string,
    params: Record<string, string | number>,
  ): Promise<any> {
    const sig = this.sign(params);
    const qs  = this.buildQs({ ...params, signature: sig });
    return this.rawRequest(method, path, qs);
  }

  private async publicRequest(
    method: 'GET',
    path: string,
    params: Record<string, string | number>,
  ): Promise<any> {
    return this.rawRequest(method, path, this.buildQs(params));
  }

  private rawRequest(method: 'GET' | 'POST', path: string, qs: string): Promise<any> {
    const hostname = new URL(this.baseUrl).hostname;
    const body = method === 'POST' ? qs : '';

    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        hostname,
        path: method === 'GET' ? `${path}?${qs}` : path,
        method,
        headers: {
          'X-MBX-APIKEY': this.apiKey,
          ...(method === 'POST' && {
            'Content-Type':   'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(body),
          }),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.code && parsed.code < 0) {
              reject(new Error(`Binance ${parsed.code}: ${parsed.msg}`));
            } else {
              resolve(parsed);
            }
          } catch {
            reject(new Error(`Non-JSON from Binance: ${data.slice(0, 300)}`));
          }
        });
      });

      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }
}
