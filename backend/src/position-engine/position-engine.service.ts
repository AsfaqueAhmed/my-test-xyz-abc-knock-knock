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
    private readonly events: EventEmitter2,
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

    const riskCheck = await this.risk.checkRisk(symbol, side, cfg.maxCapitalPerEntry, {
      ignorePositionLimit: !!existing || !!opts.ignorePositionLimit,
    });
    if (!riskCheck.allowed) { this.logger.debug(`Risk denied ${symbol}: ${riskCheck.reason}`); return false; }

    const cooldownCheck = await this.risk.checkCooldown(symbol);
    if (!cooldownCheck.allowed) { this.logger.debug(`Cooldown ${symbol}: ${cooldownCheck.reason}`); return false; }

    let executed = false;
    if (existing) {
      executed = await this.pyramid(existing, candidate);
    } else {
      executed = await this.openNew(symbol, side, candidate);
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

  private async openNew(symbol: string, side: 'LONG' | 'SHORT', candidate: TradeValidationResult): Promise<boolean> {
    const cfg = this.config.get();
    const price = this.scanner.getCurrentPrice(symbol);
    if (price <= 0) {
      this.logger.warn(`Cannot open ${symbol} ${side}: price unavailable (${price})`);
      return false;
    }

    const balance = this.balanceService.getBalance();
    if (balance <= 0) {
      this.logger.warn(`Cannot open ${symbol} ${side}: balance is $${balance.toFixed(2)}`);
      return false;
    }

    const capital = Math.min(cfg.maxCapitalPerEntry, balance * 0.1, candidate.maxSafePositionSize);
    if (capital > balance) {
      this.logger.warn(`Cannot open ${symbol} ${side}: capital $${capital.toFixed(2)} exceeds balance $${balance.toFixed(2)}`);
      return false;
    }
    const quantity = (capital * cfg.leverage) / price;
    const fee = price * quantity * FEE_RATE;

    const hardStop = side === 'LONG'
      ? price * (1 - cfg.hardStopPct / 100)
      : price * (1 + cfg.hardStopPct / 100);

    const position = await this.prisma.position.create({
      data: {
        symbol, side,
        status: side === 'LONG' ? 'OPEN_LONG' : 'OPEN_SHORT',
        entryPrice: price,
        currentPrice: price,
        quantity,
        leverage: cfg.leverage,
        hardStop,
        activationPct: cfg.activationPct,
        trailingPct: cfg.trailingPct,
        hardStopPct: cfg.hardStopPct,
        avgEntryPrice: price,
        highestPrice: side === 'LONG' ? price : null,
        lowestPrice: side === 'SHORT' ? price : null,
        fees: fee,
        entryCount: 1,
      },
    });

    await this.prisma.order.create({
      data: { positionId: position.id, type: 'MARKET', side: side === 'LONG' ? 'BUY' : 'SELL', price, quantity, fee },
    });
    await this.balanceService.recordTradeOpen(symbol, position.id, fee);

    await this.notify('POSITION_OPENED', `${side} opened`, `${symbol} @ $${price.toFixed(4)} score=${candidate.tradeScore.toFixed(1)}`);
    this.logger.log(`Opened ${side} ${symbol} @ ${price} (score ${candidate.tradeScore.toFixed(1)})`);
    this.events.emit('position.opened', { position, candidate });
    return true;
  }

  private async pyramid(position: any, candidate: TradeValidationResult): Promise<boolean> {
    const cfg = this.config.get();
    if (position.entryCount >= cfg.maxEntriesPerSymbol) return false;

    const price = this.scanner.getCurrentPrice(position.symbol);
    if (price <= 0) {
      this.logger.warn(`Cannot pyramid ${position.symbol}: price unavailable (${price})`);
      return false;
    }

    const isLong = position.side === 'LONG';
    const profitPct = isLong
      ? (price - Number(position.avgEntryPrice)) / Number(position.avgEntryPrice) * 100
      : (Number(position.avgEntryPrice) - price) / Number(position.avgEntryPrice) * 100;
    // Require at least 1% profit before adding to a position to avoid averaging into a reversal
    if (profitPct < 1.0) return false;

    const momentumStrong = candidate.momentumScore >= 50;
    const breakoutConfirmed = candidate.breakoutScore > 0;
    const scoreImproving = candidate.tradeScore >= cfg.tradeScoreThreshold;
    if (!momentumStrong || !breakoutConfirmed || !scoreImproving) return false;

    const balance = this.balanceService.getBalance();
    if (balance <= 0) return false;

    const capital = Math.min(cfg.maxCapitalPerEntry, balance * 0.1, candidate.maxSafePositionSize);
    if (capital > balance) return false;
    const newQty = (capital * cfg.leverage) / price;
    const fee = price * newQty * FEE_RATE;
    const totalQty = position.quantity + newQty;
    const newAvgEntry = (Number(position.avgEntryPrice) * Number(position.quantity) + price * newQty) / totalQty;

    await this.prisma.position.update({
      where: { id: position.id },
      data: { quantity: totalQty, avgEntryPrice: newAvgEntry, entryCount: { increment: 1 }, fees: { increment: fee } },
    });

    await this.prisma.order.create({
      data: { positionId: position.id, type: 'MARKET', side: isLong ? 'BUY' : 'SELL', price, quantity: newQty, fee },
    });
    await this.balanceService.recordTradeOpen(position.symbol, position.id, fee);

    this.logger.log(`Pyramided ${position.symbol} ${position.side} @ ${price} (entry ${position.entryCount + 1})`);
    this.events.emit('position.pyramided', {
      symbol: position.symbol,
      side: position.side,
      price,
      newAvgEntry: newAvgEntry,
      entryCount: position.entryCount + 1,
    });
    return true;
  }

  // ─── Position Update Loop ─────────────────────────────────────────────────

  @Cron('*/3 * * * * *')
  async updatePositions() {
    const openPositions = await this.prisma.position.findMany({
      where: { status: { in: ['OPEN_LONG','LONG_TRAILING','OPEN_SHORT','SHORT_TRAILING'] } },
    });
    for (const pos of openPositions) await this.updatePosition(pos);
  }

  private async updatePosition(pos: any) {
    const price = this.scanner.getCurrentPrice(pos.symbol);
    if (!price) return;

    const cfg = this.config.get();
    const isLong = pos.side === 'LONG';
    let shouldClose = false;
    let exitReason = '';
    let fillPrice = price; // default fill at scanner price
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
          // Fill at stop level — price may have gapped below it
          fillPrice = Math.max(ts, price);
        }
      }
      if (price <= Number(pos.hardStop)) {
        shouldClose = true;
        exitReason = 'HARD_STOP';
        // Fill at hard stop level — price may have gapped below it
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
          // Fill at stop level — price may have gapped above it
          fillPrice = Math.min(ts, price);
        }
      }
      if (price >= Number(pos.hardStop)) {
        shouldClose = true;
        exitReason = 'HARD_STOP';
        // Fill at hard stop level — price may have gapped above it
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
    const exitPrice = price ?? this.scanner.getCurrentPrice(pos.symbol);
    if (!exitPrice) return;

    const isLong = pos.side === 'LONG';
    const priceDiff = isLong
      ? exitPrice - Number(pos.avgEntryPrice)
      : Number(pos.avgEntryPrice) - exitPrice;

    const pnl = priceDiff * Number(pos.quantity);
    const pnlPct = (priceDiff / Number(pos.avgEntryPrice)) * 100;
    const exitFee = exitPrice * Number(pos.quantity) * FEE_RATE;
    const netPnl = pnl - exitFee;

    await this.balanceService.recordTradeClose(pos.symbol, pos.id, netPnl);
    this.risk.updateDailyPnl(netPnl);

    const duration = Math.floor((Date.now() - new Date(pos.openedAt).getTime()) / 1000);

    await this.prisma.position.update({
      where: { id: pos.id },
      data: { status: 'CLOSED', exitPrice, exitReason, closedAt: new Date(), currentPrice: exitPrice, realizedPnl: pnl, unrealizedPnl: 0, fees: { increment: exitFee } },
    });

    await this.prisma.tradeHistory.create({
      data: { symbol: pos.symbol, side: pos.side, entryPrice: Number(pos.avgEntryPrice), exitPrice, quantity: Number(pos.quantity), pnl, pnlPct, fees: Number(pos.fees ?? 0) + exitFee, duration, exitReason, entryTime: pos.openedAt, exitTime: new Date() },
    });

    await this.updateDailyStats(pnl, exitFee, pnl > 0);
    await this.notify('POSITION_CLOSED', `${pos.side} closed`, `${pos.symbol} ${exitReason} PnL: $${netPnl.toFixed(2)}`);
    this.logger.log(`Closed ${pos.symbol} ${pos.side} @ ${exitPrice} PnL: ${netPnl.toFixed(2)} (${exitReason})`);
    this.events.emit('position.closed', { pos, pnl: netPnl, exitReason, exitPrice, pnlPct, duration });
  }

  async closeAllPositions() {
    const open = await this.prisma.position.findMany({
      where: { status: { in: ['OPEN_LONG','LONG_TRAILING','OPEN_SHORT','SHORT_TRAILING'] } },
    });
    for (const pos of open) await this.closePosition(pos, undefined, 'EMERGENCY_CLOSE');
  }

  private async updateDailyStats(pnl: number, fee: number, isWin: boolean) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    try {
      await this.prisma.performanceStat.upsert({
        where: { date: today },
        update: { dailyPnl: { increment: pnl }, totalTrades: { increment: 1 }, winningTrades: isWin ? { increment: 1 } : undefined, losingTrades: !isWin ? { increment: 1 } : undefined, totalFees: { increment: fee }, equity: this.balanceService.getBalance() },
        create: { date: today, dailyPnl: pnl, totalTrades: 1, winningTrades: isWin ? 1 : 0, losingTrades: isWin ? 0 : 1, totalFees: fee, equity: this.balanceService.getBalance() },
      });
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
      a.trendScore   * cfg.weightTrend    / 100 +
      a.volumeScore  * cfg.weightVolume   / 100 +
      a.breakoutScore * cfg.weightBreakout / 100 +
      a.candleScore  * cfg.weightCandle   / 100;

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
    };
  }

  async manualOpen(symbol: string, direction: 'LONG' | 'SHORT', requestedAmount?: number) {
    const cfg = this.config.get();
    const price = this.scanner.getCurrentPrice(symbol);
    if (!price) throw new Error(`No price available for ${symbol}`);

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
    const quantity = (capital * cfg.leverage) / price;
    const fee = price * quantity * FEE_RATE;
    const hardStop = side === 'LONG'
      ? price * (1 - cfg.hardStopPct / 100)
      : price * (1 + cfg.hardStopPct / 100);

    const position = await this.prisma.position.create({
      data: {
        symbol, side,
        status: side === 'LONG' ? 'OPEN_LONG' : 'OPEN_SHORT',
        entryPrice: price, currentPrice: price,
        quantity, leverage: cfg.leverage,
        hardStop, activationPct: cfg.activationPct,
        trailingPct: cfg.trailingPct, hardStopPct: cfg.hardStopPct,
        avgEntryPrice: price,
        highestPrice: side === 'LONG' ? price : null,
        lowestPrice: side === 'SHORT' ? price : null,
        fees: fee, entryCount: 1,
      },
    });

    await this.prisma.order.create({
      data: { positionId: position.id, type: 'MARKET', side: side === 'LONG' ? 'BUY' : 'SELL', price, quantity, fee },
    });
    await this.balanceService.recordTradeOpen(symbol, position.id, fee);

    await this.notify('POSITION_OPENED', `MANUAL ${side}`, `${symbol} @ $${price} capital=$${capital.toFixed(2)} maxSafe=$${maxSafe.toFixed(0)}`);
    this.logger.log(`[MANUAL] Opened ${side} ${symbol} @ ${price} capital=$${capital.toFixed(2)} (maxSafe=$${maxSafe.toFixed(0)})`);
    this.events.emit('position.opened', { position, manual: true });

    return { success: true, symbol, side, price, capital, maxSafePositionSize: maxSafe, quantity };
  }

  getBalance() { return this.balanceService.getBalance(); }
  async getOpenPositions() {
    return this.prisma.position.findMany({ where: { status: { in: ['OPEN_LONG','LONG_TRAILING','OPEN_SHORT','SHORT_TRAILING'] } }, orderBy: { openedAt: 'desc' } });
  }
  async getAllPositions(limit = 100) {
    return this.prisma.position.findMany({ orderBy: { openedAt: 'desc' }, take: limit });
  }
  async getPosition(id: string) {
    return this.prisma.position.findUnique({ where: { id: BigInt(id) }, include: { orders: true } });
  }
}
