import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { MarketScannerService } from '../market-scanner/market-scanner.service';
import { RiskEngineService } from '../risk-engine/risk-engine.service';
import { BotConfigService } from '../config/bot-config.service';
import { DeepAnalysisService } from '../deep-analysis/deep-analysis.service';
import { BalanceService } from '../balance/balance.service';
import { TradeValidationResult } from '../trade-validator/trade-validator.service';
import { BotLogService } from '../bot-log/bot-log.service';
import { ExchangeService } from '../exchange/exchange.service';

const FEE_RATE = 0.0004;

@Injectable()
export class PositionEngineService implements OnModuleInit {
  private readonly logger = new Logger(PositionEngineService.name);
  private openingSymbols = new Set<string>(); // prevents concurrent opens for the same symbol

  constructor(
    private readonly prisma: PrismaService,
    private readonly scanner: MarketScannerService,
    private readonly risk: RiskEngineService,
    private readonly config: BotConfigService,
    private readonly deepAnalysis: DeepAnalysisService,
    private readonly balanceService: BalanceService,
    private readonly exchange: ExchangeService,
    private readonly events: EventEmitter2,
    private readonly botLog: BotLogService,
  ) {}

  async onModuleInit() {
    // Balance is owned by BalanceService — nothing to initialise here.
  }

  // ─── Portfolio Manager Events ─────────────────────────────────────────────

  @OnEvent('portfolio.openPosition')
  async onOpenPosition(candidate: TradeValidationResult) {
    await this.tryOpen(candidate);
  }

  @OnEvent('portfolio.replacePosition')
  async onReplacePosition({
    closePositionId, openCandidate, closedSymbol, closedScore, newScore, opportunityScore,
  }: {
    closePositionId: string;
    openCandidate: TradeValidationResult;
    closedSymbol: string;
    closedScore: number;
    newScore: number;
    opportunityScore: number;
  }) {
    // Open the new position FIRST — the slot isn't free yet so we must bypass the position limit.
    // Only close the old position if the open actually succeeds; otherwise leave it untouched.
    const opened = await this.tryOpen(openCandidate, { ignorePositionLimit: true });
    if (!opened) {
      this.logger.warn(
        `Replacement skipped — ${closedSymbol} kept | ${openCandidate.symbol} failed to open (score ${newScore.toFixed(1)}, opportunity +${opportunityScore.toFixed(1)})`
      );
      return;
    }
    const pos = await this.getPosition(closePositionId);
    if (pos) {
      this.logger.log(
        `REPLACED_BY_OPPORTUNITY: ${closedSymbol} (score ${closedScore.toFixed(1)}) → ${openCandidate.symbol} (score ${newScore.toFixed(1)}, +${opportunityScore.toFixed(1)} opportunity)`
      );
      await this.closePosition(pos, undefined, 'REPLACED_BY_OPPORTUNITY');
    }
  }

  // ─── Position Opening ─────────────────────────────────────────────────────

  async tryOpen(candidate: TradeValidationResult, opts: { ignorePositionLimit?: boolean } = {}): Promise<boolean> {
    const { symbol, direction } = candidate;
    const side = direction as 'LONG' | 'SHORT';

    if (this.openingSymbols.has(symbol)) {
      this.logger.debug(`Skipping ${symbol} — open already in progress`);
      return false;
    }
    this.openingSymbols.add(symbol);
    try {
      return await this._tryOpen(candidate, opts, side);
    } finally {
      this.openingSymbols.delete(symbol);
    }
  }

  private async _tryOpen(candidate: TradeValidationResult, opts: { ignorePositionLimit?: boolean }, side: 'LONG' | 'SHORT'): Promise<boolean> {
    const cfg = this.config.get();
    const { symbol } = candidate;

    // Check for existing position to pyramid
    const existing = await this.prisma.position.findFirst({
      where: { symbol, side, status: { in: ['OPEN_LONG','LONG_TRAILING','OPEN_SHORT','SHORT_TRAILING'] } },
    });

    // Use the same capital cap that openNew/pyramid will actually use,
    // so the notional exposure check isn't inflated by a balance-capped trade.
    const balance = this.balanceService.getBalance();
    const effectiveCapital = Math.min(cfg.maxCapitalPerEntry, balance * 0.1);
    const riskCheck = await this.risk.checkRisk(symbol, side, effectiveCapital, {
      ignorePositionLimit: !!existing || !!opts.ignorePositionLimit,
    });
    if (!riskCheck.allowed) {
      this.logger.debug(`Risk denied ${symbol}: ${riskCheck.reason}`);
      this.botLog.log('WARN', 'RISK', 'SIGNAL_BLOCKED', `${symbol} ${side} blocked by risk: ${riskCheck.reason}`, symbol, { direction: side, reason: riskCheck.reason });
      return false;
    }

    const cooldownCheck = await this.risk.checkCooldown(symbol);
    if (!cooldownCheck.allowed) {
      this.logger.debug(`Cooldown ${symbol}: ${cooldownCheck.reason}`);
      this.botLog.log('WARN', 'RISK', 'SIGNAL_BLOCKED', `${symbol} ${side} blocked by cooldown: ${cooldownCheck.reason}`, symbol, { direction: side, reason: cooldownCheck.reason });
      return false;
    }

    // Use reduced capital if risk check capped it due to exposure headroom
    const capitalOverride = riskCheck.reducedCapital;
    if (capitalOverride) {
      this.logger.log(`Exposure headroom: reducing capital for ${symbol} to $${capitalOverride.toFixed(2)}`);
      this.botLog.log('INFO', 'RISK', 'CAPITAL_REDUCED', `${symbol} ${side} capital reduced to $${capitalOverride.toFixed(2)} due to exposure headroom`, symbol, { direction: side, reducedCapital: capitalOverride });
    }

    let executed = false;
    if (existing) {
      executed = await this.pyramid(existing, candidate, capitalOverride);
    } else {
      executed = await this.openNew(symbol, side, candidate, capitalOverride);
    }

    if (!executed) return false;

    await this.risk.trackEntry(symbol);
    await this.persistSignal(candidate);

    // Mark signal as acted
    try {
      await this.prisma.signal.updateMany({
        where: { symbol, direction: side, acted: false },
        data: { acted: true },
      });
    } catch (_) {}
    return true;
  }

  private async openNew(symbol: string, side: 'LONG' | 'SHORT', candidate: TradeValidationResult, capitalOverride?: number): Promise<boolean> {
    const cfg = this.config.get();
    const scannerPrice = this.scanner.getCurrentPrice(symbol);
    if (scannerPrice <= 0) {
      this.logger.warn(`Cannot open ${symbol} ${side}: price unavailable (${scannerPrice})`);
      this.botLog.log('WARN', 'POSITION', 'SIGNAL_BLOCKED', `${symbol} ${side} blocked: price unavailable`, symbol, { direction: side, reason: 'Price unavailable' });
      return false;
    }

    const balance = this.balanceService.getBalance();
    if (balance <= 0) {
      this.logger.warn(`Cannot open ${symbol} ${side}: balance is $${balance.toFixed(2)}`);
      this.botLog.log('WARN', 'POSITION', 'SIGNAL_BLOCKED', `${symbol} ${side} blocked: insufficient balance $${balance.toFixed(2)}`, symbol, { direction: side, reason: `Balance $${balance.toFixed(2)}` });
      return false;
    }

    const capital = Math.min(
      capitalOverride ?? cfg.maxCapitalPerEntry,
      cfg.maxCapitalPerEntry,
      balance * 0.1,
      candidate.maxSafePositionSize,
    );
    if (capital <= 0) {
      this.logger.warn(`Cannot open ${symbol} ${side}: capital $${capital.toFixed(2)} too low`);
      return false;
    }

    const mode = this.config.getMode();
    let fillPrice = scannerPrice;
    let rawQty = (capital * cfg.leverage) / scannerPrice;

    // ─── Symbol filter validation (paper + live) ──────────────────────────
    const qtyResult = this.exchange.floorQuantity(symbol, rawQty);
    if (qtyResult === null) {
      const f = this.exchange.getSymbolFilters(symbol);
      this.logger.warn(`Cannot open ${symbol} ${side}: quantity ${rawQty.toFixed(8)} < minQty ${f.minQty}`);
      this.botLog.log('WARN', 'POSITION', 'SIGNAL_BLOCKED', `${symbol} ${side} blocked: quantity below exchange minimum`, symbol, { direction: side, rawQty, minQty: f.minQty });
      return false;
    }
    let quantity = qtyResult.quantity;
    if (qtyResult.capped) {
      const f = this.exchange.getSymbolFilters(symbol);
      this.logger.log(`${symbol} ${side}: quantity capped at market max ${f.maxMarketQty} (requested ${rawQty.toFixed(6)})`);
      this.botLog.log('INFO', 'POSITION', 'QUANTITY_CAPPED', `${symbol} ${side} quantity capped at market max ${f.maxMarketQty}`, symbol, { direction: side, rawQty, maxMarketQty: f.maxMarketQty });
    }
    const validationError = this.exchange.validateOrder(symbol, quantity, scannerPrice);
    if (validationError) {
      this.logger.warn(`Cannot open ${symbol} ${side}: ${validationError}`);
      this.botLog.log('WARN', 'POSITION', 'SIGNAL_BLOCKED', `${symbol} ${side} blocked: ${validationError}`, symbol, { direction: side, reason: validationError });
      return false;
    }
    let exchangeOrderId: string | undefined;

    // ─── Live trading: place real order on Binance ────────────────────────
    if (!cfg.paperTrading) {
      if (!this.exchange.isConfigured()) {
        this.logger.error(`Live trading enabled but BINANCE_API_KEY / BINANCE_API_SECRET not set`);
        this.botLog.log('ERROR', 'EXCHANGE', 'ORDER_FAILED', `${symbol} ${side} blocked: API keys not configured`, symbol, { direction: side });
        return false;
      }
      try {
        await this.exchange.setLeverage(symbol, cfg.leverage);
        const fill = await this.exchange.placeMarketOrder(
          symbol,
          side === 'LONG' ? 'BUY' : 'SELL',
          quantity,
        );
        fillPrice = fill.avgPrice || scannerPrice;
        quantity  = fill.executedQty || quantity;
        exchangeOrderId = String(fill.orderId);
        this.logger.log(`[LIVE] ${side} ${symbol} filled orderId=${fill.orderId} qty=${quantity} avgPrice=${fillPrice}`);
        this.botLog.log('INFO', 'EXCHANGE', 'ORDER_FILLED', `${symbol} ${side} live order filled @ ${fillPrice}`, symbol, { direction: side, orderId: exchangeOrderId, quantity, fillPrice });
      } catch (err) {
        this.logger.error(`Exchange order failed for ${symbol} ${side}: ${err.message}`);
        this.botLog.log('ERROR', 'EXCHANGE', 'ORDER_FAILED', `${symbol} ${side} live order failed: ${err.message}`, symbol, { direction: side, error: err.message });
        return false;
      }
    }

    const fee = fillPrice * quantity * FEE_RATE;
    const hardStop = side === 'LONG'
      ? fillPrice * (1 - cfg.hardStopPct / 100)
      : fillPrice * (1 + cfg.hardStopPct / 100);

    const position = await this.prisma.position.create({
      data: {
        symbol, side, mode,
        status: side === 'LONG' ? 'OPEN_LONG' : 'OPEN_SHORT',
        entryPrice: fillPrice,
        currentPrice: fillPrice,
        quantity,
        leverage: cfg.leverage,
        hardStop,
        activationPct: cfg.activationPct,
        trailingPct: cfg.trailingPct,
        hardStopPct: cfg.hardStopPct,
        avgEntryPrice: fillPrice,
        highestPrice: side === 'LONG' ? fillPrice : null,
        lowestPrice: side === 'SHORT' ? fillPrice : null,
        fees: fee,
        entryCount: 1,
      },
    });

    await this.prisma.order.create({
      data: {
        positionId: position.id,
        type: 'MARKET',
        side: side === 'LONG' ? 'BUY' : 'SELL',
        price: fillPrice,
        quantity,
        fee,
        exchangeOrderId: exchangeOrderId ?? null,
      },
    });
    await this.balanceService.recordTradeOpen(symbol, position.id, fee, mode);

    const modeLabel = mode === 'PAPER' ? '[PAPER]' : mode === 'TESTNET' ? '[TESTNET]' : '[LIVE]';
    await this.notify('POSITION_OPENED', `${modeLabel} ${side} opened`, `${symbol} @ $${fillPrice.toFixed(4)} score=${candidate.tradeScore.toFixed(1)}`);
    this.logger.log(`${modeLabel} Opened ${side} ${symbol} @ ${fillPrice} (score ${candidate.tradeScore.toFixed(1)})`);
    this.events.emit('position.opened', { position, candidate });
    return true;
  }

  private async pyramid(position: any, candidate: TradeValidationResult, capitalOverride?: number): Promise<boolean> {
    const cfg = this.config.get();
    if (position.entryCount >= cfg.maxEntriesPerSymbol) return false;

    const scannerPrice = this.scanner.getCurrentPrice(position.symbol);
    if (scannerPrice <= 0) {
      this.logger.warn(`Cannot pyramid ${position.symbol}: price unavailable (${scannerPrice})`);
      return false;
    }

    const isLong = position.side === 'LONG';
    const profitPct = isLong
      ? (scannerPrice - Number(position.avgEntryPrice)) / Number(position.avgEntryPrice) * 100
      : (Number(position.avgEntryPrice) - scannerPrice) / Number(position.avgEntryPrice) * 100;
    // Require at least 1% profit before adding to a position to avoid averaging into a reversal
    if (profitPct < 1.0) return false;

    const momentumStrong = candidate.momentumScore >= 50;
    const breakoutConfirmed = candidate.breakoutScore > 0;
    const scoreImproving = candidate.tradeScore >= cfg.tradeScoreThreshold;
    if (!momentumStrong || !breakoutConfirmed || !scoreImproving) return false;

    const balance = this.balanceService.getBalance();
    if (balance <= 0) return false;

    const capital = Math.min(
      capitalOverride ?? cfg.maxCapitalPerEntry,
      cfg.maxCapitalPerEntry,
      balance * 0.1,
      candidate.maxSafePositionSize,
    );
    if (capital <= 0) return false;

    const mode = this.config.getMode();
    let fillPrice = scannerPrice;
    const rawNewQty = (capital * cfg.leverage) / scannerPrice;

    // ─── Symbol filter validation (paper + live) ──────────────────────────
    const pyramidQtyResult = this.exchange.floorQuantity(position.symbol, rawNewQty);
    if (pyramidQtyResult === null) {
      this.logger.warn(`Cannot pyramid ${position.symbol}: quantity below exchange minimum`);
      return false;
    }
    let newQty = pyramidQtyResult.quantity;
    if (pyramidQtyResult.capped) {
      this.logger.log(`${position.symbol} pyramid: quantity capped at market max ${this.exchange.getSymbolFilters(position.symbol).maxMarketQty}`);
    }
    const pyramidValidation = this.exchange.validateOrder(position.symbol, newQty, scannerPrice);
    if (pyramidValidation) {
      this.logger.warn(`Cannot pyramid ${position.symbol}: ${pyramidValidation}`);
      return false;
    }
    let exchangeOrderId: string | undefined;

    // ─── Live trading: place real pyramid order ───────────────────────────
    if (!cfg.paperTrading) {
      if (!this.exchange.isConfigured()) {
        this.logger.error(`Live pyramid blocked for ${position.symbol}: API keys not set`);
        return false;
      }
      try {
        const fill = await this.exchange.placeMarketOrder(
          position.symbol,
          isLong ? 'BUY' : 'SELL',
          newQty,
        );
        fillPrice = fill.avgPrice || scannerPrice;
        newQty    = fill.executedQty || newQty;
        exchangeOrderId = String(fill.orderId);
        this.logger.log(`[LIVE] Pyramid ${position.symbol} orderId=${fill.orderId} qty=${newQty} avgPrice=${fillPrice}`);
      } catch (err) {
        this.logger.error(`Exchange pyramid order failed for ${position.symbol}: ${err.message}`);
        this.botLog.log('ERROR', 'EXCHANGE', 'ORDER_FAILED', `${position.symbol} pyramid failed: ${err.message}`, position.symbol, { error: err.message });
        return false;
      }
    }

    const fee = fillPrice * newQty * FEE_RATE;
    const totalQty = Number(position.quantity) + newQty;
    const newAvgEntry = (Number(position.avgEntryPrice) * Number(position.quantity) + fillPrice * newQty) / totalQty;

    await this.prisma.position.update({
      where: { id: position.id },
      data: { quantity: totalQty, avgEntryPrice: newAvgEntry, entryCount: { increment: 1 }, fees: { increment: fee } },
    });

    await this.prisma.order.create({
      data: {
        positionId: position.id,
        type: 'MARKET',
        side: isLong ? 'BUY' : 'SELL',
        price: fillPrice,
        quantity: newQty,
        fee,
        exchangeOrderId: exchangeOrderId ?? null,
      },
    });
    await this.balanceService.recordTradeOpen(position.symbol, position.id, fee, mode);

    const modeLabel = cfg.paperTrading ? '[PAPER]' : cfg.binanceTestnet ? '[TESTNET]' : '[LIVE]';
    this.logger.log(`${modeLabel} Pyramided ${position.symbol} ${position.side} @ ${fillPrice} (entry ${position.entryCount + 1})`);
    this.events.emit('position.pyramided', {
      symbol: position.symbol,
      side: position.side,
      price: fillPrice,
      newAvgEntry,
      entryCount: position.entryCount + 1,
    });
    return true;
  }

  // ─── Position Update Loop ─────────────────────────────────────────────────

  @Cron('*/3 * * * * *')
  async updatePositions() {
    const mode = this.config.getMode();
    const openPositions = await this.prisma.position.findMany({
      where: { status: { in: ['OPEN_LONG','LONG_TRAILING','OPEN_SHORT','SHORT_TRAILING'] }, mode },
    });
    for (const pos of openPositions) await this.updatePosition(pos);
  }

  private async updatePosition(pos: any) {
    const price = this.scanner.getCurrentPrice(pos.symbol);
    if (!price) return;

    const isLong = pos.side === 'LONG';
    let shouldClose = false;
    let exitReason = '';
    let fillPrice = price;
    const updates: any = { currentPrice: price };

    if (isLong) {
      const newHighest = Math.max(Number(pos.highestPrice ?? price), price);
      updates.highestPrice = newHighest;
      updates.unrealizedPnl = (price - Number(pos.avgEntryPrice)) * Number(pos.quantity);

      if (price >= Number(pos.entryPrice) * (1 + pos.activationPct / 100) && pos.status === 'OPEN_LONG') {
        updates.status = 'LONG_TRAILING';
      }
      if (pos.status === 'LONG_TRAILING' || updates.status === 'LONG_TRAILING') {
        const floor = Number(pos.avgEntryPrice) * (1 + pos.activationPct / 100);
        const trailing = newHighest * (1 - pos.trailingPct / 100);
        const candidate = Math.max(floor, trailing);
        const ts = Math.max(candidate, Number(pos.trailingStop ?? 0));
        updates.trailingStop = ts;
        if (price <= ts) {
          shouldClose = true;
          exitReason = 'TRAILING_STOP';
          fillPrice = Math.max(ts, price);
        }
      }
      if (price <= Number(pos.hardStop)) {
        shouldClose = true;
        exitReason = 'HARD_STOP';
        fillPrice = Math.max(Number(pos.hardStop), price);
      }
    } else {
      const newLowest = Math.min(Number(pos.lowestPrice ?? price), price);
      updates.lowestPrice = newLowest;
      updates.unrealizedPnl = (Number(pos.avgEntryPrice) - price) * Number(pos.quantity);

      if (price <= Number(pos.entryPrice) * (1 - pos.activationPct / 100) && pos.status === 'OPEN_SHORT') {
        updates.status = 'SHORT_TRAILING';
      }
      if (pos.status === 'SHORT_TRAILING' || updates.status === 'SHORT_TRAILING') {
        const ceiling = Number(pos.avgEntryPrice) * (1 - pos.activationPct / 100);
        const trailing = newLowest * (1 + pos.trailingPct / 100);
        const candidate = Math.min(ceiling, trailing);
        const ts = Math.min(candidate, Number(pos.trailingStop ?? Infinity));
        updates.trailingStop = ts;
        if (price >= ts) {
          shouldClose = true;
          exitReason = 'TRAILING_STOP';
          fillPrice = Math.min(ts, price);
        }
      }
      if (price >= Number(pos.hardStop)) {
        shouldClose = true;
        exitReason = 'HARD_STOP';
        fillPrice = Math.min(Number(pos.hardStop), price);
      }
    }

    if (shouldClose) {
      await this.closePosition(pos, fillPrice, exitReason);
    } else {
      await this.prisma.position.update({ where: { id: pos.id }, data: updates });
    }
  }

  // ─── Close Position ───────────────────────────────────────────────────────

  async closePosition(pos: any, price?: number, exitReason = 'MANUAL') {
    const cfg = this.config.get();
    let exitPrice = price ?? this.scanner.getCurrentPrice(pos.symbol);
    if (!exitPrice) return;

    // ─── Live trading: send reduce-only close order first ─────────────────
    if (!cfg.paperTrading) {
      if (!this.exchange.isConfigured()) {
        this.logger.error(`Live close blocked for ${pos.symbol}: API keys not set`);
        this.botLog.log('ERROR', 'EXCHANGE', 'ORDER_FAILED', `${pos.symbol} close blocked: API keys not configured`, pos.symbol, { exitReason });
        return; // Do not close in DB — keep in sync with exchange
      }
      try {
        const closeSide = pos.side === 'LONG' ? 'SELL' : 'BUY';
        const fill = await this.exchange.placeMarketOrder(
          pos.symbol,
          closeSide,
          Number(pos.quantity),
          true, // reduceOnly
        );
        exitPrice = fill.avgPrice || exitPrice;
        this.logger.log(`[LIVE] Close ${pos.symbol} ${closeSide} orderId=${fill.orderId} qty=${fill.executedQty} avgPrice=${exitPrice}`);
        this.botLog.log('INFO', 'EXCHANGE', 'ORDER_FILLED', `${pos.symbol} close filled @ ${exitPrice}`, pos.symbol, { orderId: String(fill.orderId), exitReason, fillPrice: exitPrice });
      } catch (err) {
        this.logger.error(`Exchange close failed for ${pos.symbol}: ${err.message}`);
        this.botLog.log('ERROR', 'EXCHANGE', 'ORDER_FAILED', `${pos.symbol} close failed: ${err.message}`, pos.symbol, { exitReason, error: err.message });
        return; // Do not close in DB — keep in sync with exchange
      }
    }

    const isLong = pos.side === 'LONG';
    const priceDiff = isLong
      ? exitPrice - Number(pos.avgEntryPrice)
      : Number(pos.avgEntryPrice) - exitPrice;

    const pnl = priceDiff * Number(pos.quantity);
    const pnlPct = (priceDiff / Number(pos.avgEntryPrice)) * 100;
    const exitFee = exitPrice * Number(pos.quantity) * FEE_RATE;
    const netPnl = pnl - exitFee;

    const posMode = pos.mode ?? this.config.getMode();
    await this.balanceService.recordTradeClose(pos.symbol, pos.id, netPnl, posMode);
    this.risk.updateDailyPnl(netPnl);

    const duration = Math.floor((Date.now() - new Date(pos.openedAt).getTime()) / 1000);

    await this.prisma.position.update({
      where: { id: pos.id },
      data: { status: 'CLOSED', exitPrice, exitReason, closedAt: new Date(), currentPrice: exitPrice, realizedPnl: pnl, unrealizedPnl: 0, fees: { increment: exitFee } },
    });

    await this.prisma.tradeHistory.create({
      data: { symbol: pos.symbol, side: pos.side, mode: posMode, entryPrice: Number(pos.avgEntryPrice), exitPrice, quantity: Number(pos.quantity), pnl, pnlPct, fees: Number(pos.fees ?? 0) + exitFee, duration, exitReason, entryTime: pos.openedAt, exitTime: new Date() },
    });

    await this.updateDailyStats(pnl, exitFee, pnl > 0, posMode);
    const modeLabel = posMode === 'PAPER' ? '[PAPER]' : posMode === 'TESTNET' ? '[TESTNET]' : '[LIVE]';
    await this.notify('POSITION_CLOSED', `${modeLabel} ${pos.side} closed`, `${pos.symbol} ${exitReason} PnL: $${netPnl.toFixed(2)}`);
    this.logger.log(`${modeLabel} Closed ${pos.symbol} ${pos.side} @ ${exitPrice} PnL: ${netPnl.toFixed(2)} (${exitReason})`);
    this.events.emit('position.closed', { pos, pnl: netPnl, exitReason, exitPrice, pnlPct, duration });
  }

  async closeAllPositions() {
    const mode = this.config.getMode();
    const open = await this.prisma.position.findMany({
      where: { status: { in: ['OPEN_LONG','LONG_TRAILING','OPEN_SHORT','SHORT_TRAILING'] }, mode },
    });
    for (const pos of open) await this.closePosition(pos, undefined, 'EMERGENCY_CLOSE');
  }

  private async updateDailyStats(pnl: number, fee: number, isWin: boolean, mode: string) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    try {
      const existing = await this.prisma.performanceStat.findFirst({ where: { date: today, mode } });
      if (existing) {
        await this.prisma.performanceStat.update({
          where: { id: existing.id },
          data: {
            dailyPnl: { increment: pnl },
            totalTrades: { increment: 1 },
            winningTrades: isWin ? { increment: 1 } : undefined,
            losingTrades: !isWin ? { increment: 1 } : undefined,
            totalFees: { increment: fee },
            equity: this.balanceService.getBalance(),
          },
        });
      } else {
        await this.prisma.performanceStat.create({
          data: { date: today, mode, dailyPnl: pnl, totalTrades: 1, winningTrades: isWin ? 1 : 0, losingTrades: isWin ? 0 : 1, totalFees: fee, equity: this.balanceService.getBalance() },
        });
      }
    } catch (_) {}
  }

  private async notify(type: string, title: string, message: string) {
    try { await this.prisma.notification.create({ data: { type, title, message } }); } catch (_) {}
  }

  private async persistSignal(candidate: TradeValidationResult) {
    try {
      await this.prisma.signal.create({
        data: {
          symbol: candidate.symbol,
          direction: candidate.direction,
          mode: this.config.getMode(),
          momentumScore: candidate.momentumScore / 100,
          confidence: candidate.tradeScore / 100,
          trendDirection: candidate.trendScore >= 100
            ? (candidate.direction === 'LONG' ? 'BULLISH' : 'BEARISH')
            : 'NEUTRAL',
          volumeRatio: candidate.volumeRatio,
          breakoutType: candidate.breakoutScore > 0
            ? (candidate.direction === 'LONG' ? 'BULLISH' : 'BEARISH')
            : null,
          acted: true,
        },
      });
    } catch (_) {}
  }

  // ─── Manual Trading ───────────────────────────────────────────────────────

  async checkManual(symbol: string, direction: 'LONG' | 'SHORT') {
    const price = this.scanner.getCurrentPrice(symbol);
    if (!price) throw new Error(`No price available for ${symbol}`);

    const opposite = direction === 'LONG' ? 'SHORT' : 'LONG';
    const [analysis, oppositeAnalysis] = await Promise.all([
      this.deepAnalysis.analyse(symbol, direction),
      this.deepAnalysis.analyse(symbol, opposite),
    ]);

    const cfg = this.config.get();
    const effectiveMax = Math.min(cfg.maxCapitalPerEntry, this.balanceService.getBalance() * 0.1, analysis.maxSafePositionSize);

    const partialScore = (a: typeof analysis) =>
      a.trendScore    * cfg.weightTrend    / 100 +
      a.volumeScore   * cfg.weightVolume   / 100 +
      a.breakoutScore * cfg.weightBreakout / 100 +
      a.candleScore   * cfg.weightCandle   / 100;

    const thisScore     = partialScore(analysis);
    const oppositeScore = partialScore(oppositeAnalysis);

    let directionWarning: string | undefined;
    if (oppositeScore > thisScore + 10) {
      directionWarning =
        `${opposite} scores ${oppositeScore.toFixed(1)} vs ${direction} ${thisScore.toFixed(1)} on structure — consider ${opposite} instead`;
    }

    return {
      symbol,
      direction,
      price,
      maxSafePositionSize: analysis.maxSafePositionSize,
      effectiveMax,
      reasons: analysis.reasons,
      structureScore: thisScore,
      oppositeDirection: opposite,
      oppositeStructureScore: oppositeScore,
      directionWarning,
      paperTrading: cfg.paperTrading,
      exchangeConfigured: this.exchange.isConfigured(),
    };
  }

  async manualOpen(symbol: string, direction: 'LONG' | 'SHORT', requestedAmount?: number) {
    const cfg = this.config.get();
    const scannerPrice = this.scanner.getCurrentPrice(symbol);
    if (!scannerPrice) throw new Error(`No price available for ${symbol}`);

    const analysis = await this.deepAnalysis.analyse(symbol, direction);
    const maxSafe = analysis.maxSafePositionSize;

    if (maxSafe < cfg.minPositionSize) {
      throw new Error(`${symbol} liquidity too thin — max safe size $${maxSafe.toFixed(2)} is below minimum $${cfg.minPositionSize}`);
    }

    const balance = this.balanceService.getBalance();
    if (balance <= 0) throw new Error(`Insufficient balance`);

    const capital = Math.min(
      requestedAmount ?? cfg.maxCapitalPerEntry,
      cfg.maxCapitalPerEntry,
      balance * 0.1,
      maxSafe,
    );

    if (capital <= 0) throw new Error(`Insufficient balance`);
    if (capital > balance) throw new Error(`Capital $${capital.toFixed(2)} exceeds available balance $${balance.toFixed(2)}`);

    const side = direction;
    const mode = this.config.getMode();
    let fillPrice = scannerPrice;
    const rawQty = (capital * cfg.leverage) / scannerPrice;

    // ─── Symbol filter validation (paper + live) ──────────────────────────
    const manualQtyResult = this.exchange.floorQuantity(symbol, rawQty);
    if (manualQtyResult === null) {
      const f = this.exchange.getSymbolFilters(symbol);
      throw new Error(`Quantity ${rawQty.toFixed(8)} below exchange minimum ${f.minQty} for ${symbol}`);
    }
    const manualValidation = this.exchange.validateOrder(symbol, manualQtyResult.quantity, scannerPrice);
    if (manualValidation) throw new Error(manualValidation);

    let quantity = manualQtyResult.quantity;
    let exchangeOrderId: string | undefined;

    // ─── Live trading: place real manual order ────────────────────────────
    if (!cfg.paperTrading) {
      if (!this.exchange.isConfigured()) {
        throw new Error('Live trading enabled but BINANCE_API_KEY / BINANCE_API_SECRET not set');
      }
      await this.exchange.setLeverage(symbol, cfg.leverage);
      const fill = await this.exchange.placeMarketOrder(
        symbol,
        side === 'LONG' ? 'BUY' : 'SELL',
        quantity,
      );
      fillPrice = fill.avgPrice || scannerPrice;
      quantity  = fill.executedQty || quantity;
      exchangeOrderId = String(fill.orderId);
      this.logger.log(`[LIVE MANUAL] ${side} ${symbol} orderId=${fill.orderId} qty=${quantity} avgPrice=${fillPrice}`);
    }

    const fee = fillPrice * quantity * FEE_RATE;
    const hardStop = side === 'LONG'
      ? fillPrice * (1 - cfg.hardStopPct / 100)
      : fillPrice * (1 + cfg.hardStopPct / 100);

    const position = await this.prisma.position.create({
      data: {
        symbol, side, mode,
        status: side === 'LONG' ? 'OPEN_LONG' : 'OPEN_SHORT',
        entryPrice: fillPrice, currentPrice: fillPrice,
        quantity, leverage: cfg.leverage,
        hardStop, activationPct: cfg.activationPct,
        trailingPct: cfg.trailingPct, hardStopPct: cfg.hardStopPct,
        avgEntryPrice: fillPrice,
        highestPrice: side === 'LONG' ? fillPrice : null,
        lowestPrice: side === 'SHORT' ? fillPrice : null,
        fees: fee, entryCount: 1,
      },
    });

    await this.prisma.order.create({
      data: {
        positionId: position.id,
        type: 'MARKET',
        side: side === 'LONG' ? 'BUY' : 'SELL',
        price: fillPrice,
        quantity,
        fee,
        exchangeOrderId: exchangeOrderId ?? null,
      },
    });
    await this.balanceService.recordTradeOpen(symbol, position.id, fee, mode);

    const modeLabel = mode === 'PAPER' ? '[PAPER MANUAL]' : mode === 'TESTNET' ? '[TESTNET MANUAL]' : '[LIVE MANUAL]';
    await this.notify('POSITION_OPENED', `${modeLabel} ${side}`, `${symbol} @ $${fillPrice} capital=$${capital.toFixed(2)} maxSafe=$${maxSafe.toFixed(0)}`);
    this.logger.log(`${modeLabel} Opened ${side} ${symbol} @ ${fillPrice} capital=$${capital.toFixed(2)} (maxSafe=$${maxSafe.toFixed(0)})`);
    this.events.emit('position.opened', { position, manual: true });

    return { success: true, symbol, side, mode, price: fillPrice, capital, maxSafePositionSize: maxSafe, quantity, exchangeOrderId };
  }

  getBalance() { return this.balanceService.getBalance(); }
  async getOpenPositions() {
    const mode = this.config.getMode();
    return this.prisma.position.findMany({ where: { status: { in: ['OPEN_LONG','LONG_TRAILING','OPEN_SHORT','SHORT_TRAILING'] }, mode }, orderBy: { openedAt: 'desc' } });
  }
  async getAllPositions(limit = 100) {
    const mode = this.config.getMode();
    return this.prisma.position.findMany({ where: { mode }, orderBy: { openedAt: 'desc' }, take: limit });
  }
  async getPosition(id: string) {
    return this.prisma.position.findUnique({ where: { id: BigInt(id) }, include: { orders: true } });
  }
}
