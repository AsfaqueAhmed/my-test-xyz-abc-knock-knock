import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { MarketDataService } from '../market-data/market-data.service';
import { RiskEngineService } from '../risk-engine/risk-engine.service';
import { BotConfigService } from '../config/bot-config.service';
import { SignalResult } from '../signal-engine/signal-engine.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

const FEE_RATE = 0.0004; // 0.04% per side (Binance futures taker)

@Injectable()
export class PositionEngineService implements OnModuleInit {
  private readonly logger = new Logger(PositionEngineService.name);
  private balance: number = 10000;
  private botRunning = false;
  private botPaused = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly marketData: MarketDataService,
    private readonly risk: RiskEngineService,
    private readonly botConfig: BotConfigService,
    private readonly events: EventEmitter2,
  ) {}

  async onModuleInit() {
    const config = this.botConfig.get();
    this.balance = config.initialBalance;
    await this.recoverBalance();
  }

  private async recoverBalance() {
    // Sum realized PnL from trade history
    const trades = await this.prisma.tradeHistory.findMany();
    const totalPnl = trades.reduce((s, t) => s + t.pnl - t.fees, 0);
    const config = this.botConfig.get();
    this.balance = config.initialBalance + totalPnl;
  }

  startBot() {
    this.botRunning = true;
    this.botPaused = false;
    this.logger.log('Bot started');
  }

  stopBot() {
    this.botRunning = false;
    this.botPaused = false;
    this.logger.log('Bot stopped');
  }

  pauseBot() {
    this.botPaused = true;
    this.logger.log('Bot paused');
  }

  resumeBot() {
    this.botPaused = false;
    this.logger.log('Bot resumed');
  }

  getBotStatus() {
    return {
      running: this.botRunning,
      paused: this.botPaused,
      balance: this.balance,
    };
  }

  @OnEvent('signal.generated')
  async onSignal(signal: SignalResult) {
    if (!this.botRunning || this.botPaused) return;
    const config = this.botConfig.get();
    if (!config.tradingEnabled) return;

    if (signal.direction === 'LONG' || signal.direction === 'SHORT') {
      await this.tryOpenPosition(signal);
    }
  }

  async tryOpenPosition(signal: SignalResult) {
    const config = this.botConfig.get();
    const symbol = signal.symbol;
    const side = signal.direction as 'LONG' | 'SHORT';

    // Risk checks
    const riskCheck = await this.risk.checkRisk(symbol, side, config.maxCapitalPerEntry);
    if (!riskCheck.allowed) {
      this.logger.debug(`Risk check failed for ${symbol}: ${riskCheck.reason}`);
      return;
    }

    const cooldownCheck = await this.risk.checkCooldown(symbol);
    if (!cooldownCheck.allowed) {
      this.logger.debug(`Cooldown check failed for ${symbol}: ${cooldownCheck.reason}`);
      return;
    }

    // Check if we have an existing position to pyramid
    const existing = await this.prisma.position.findFirst({
      where: {
        symbol,
        status: { in: ['OPEN_LONG', 'LONG_TRAILING', 'OPEN_SHORT', 'SHORT_TRAILING'] },
        side,
      },
    });

    if (existing) {
      await this.addPyramidEntry(existing, signal);
    } else {
      await this.openNewPosition(symbol, side, signal);
    }

    await this.risk.trackEntry(symbol);
  }

  private async openNewPosition(symbol: string, side: 'LONG' | 'SHORT', signal: SignalResult) {
    const config = this.botConfig.get();
    const price = this.marketData.getLastPrice(symbol);
    if (price === 0) return;

    const capital = Math.min(config.maxCapitalPerEntry, this.balance * 0.1);
    const quantity = (capital * config.leverage) / price;
    const fee = capital * FEE_RATE;

    let hardStop: number;
    let status: string;
    let highestPrice: number | null = null;
    let lowestPrice: number | null = null;

    if (side === 'LONG') {
      hardStop = price * (1 - config.hardStopPct / 100);
      status = 'OPEN_LONG';
      highestPrice = price;
    } else {
      hardStop = price * (1 + config.hardStopPct / 100);
      status = 'OPEN_SHORT';
      lowestPrice = price;
    }

    this.balance -= fee;

    const position = await this.prisma.position.create({
      data: {
        symbol,
        side,
        status,
        entryPrice: price,
        currentPrice: price,
        quantity,
        leverage: config.leverage,
        hardStop,
        activationPct: config.activationPct,
        trailingPct: config.trailingPct,
        hardStopPct: config.hardStopPct,
        avgEntryPrice: price,
        highestPrice,
        lowestPrice,
        fees: fee,
        entryCount: 1,
      },
    });

    await this.prisma.order.create({
      data: {
        positionId: position.id,
        type: 'MARKET',
        side: side === 'LONG' ? 'BUY' : 'SELL',
        price,
        quantity,
        fee,
      },
    });

    await this.createNotification('POSITION_OPENED', `${side} position opened`, `${symbol} ${side} @ $${price.toFixed(2)}`);
    this.logger.log(`Opened ${side} position for ${symbol} @ ${price}`);
    this.events.emit('position.opened', position);
  }

  private async addPyramidEntry(position: any, signal: SignalResult) {
    const config = this.botConfig.get();
    if (position.entryCount >= config.maxEntriesPerSymbol) return;

    const price = this.marketData.getLastPrice(position.symbol);
    if (price === 0) return;

    // Only pyramid if profitable
    const isLong = position.side === 'LONG';
    const isProfitable = isLong ? price > position.entryPrice : price < position.entryPrice;
    if (!isProfitable) return;

    const capital = Math.min(config.maxCapitalPerEntry, this.balance * 0.1);
    const newQty = (capital * config.leverage) / price;
    const fee = capital * FEE_RATE;
    const totalQty = position.quantity + newQty;
    const newAvgEntry = (position.avgEntryPrice * position.quantity + price * newQty) / totalQty;

    this.balance -= fee;

    await this.prisma.position.update({
      where: { id: position.id },
      data: {
        quantity: totalQty,
        avgEntryPrice: newAvgEntry,
        entryCount: { increment: 1 },
        fees: { increment: fee },
      },
    });

    await this.prisma.order.create({
      data: {
        positionId: position.id,
        type: 'MARKET',
        side: isLong ? 'BUY' : 'SELL',
        price,
        quantity: newQty,
        fee,
      },
    });

    this.logger.log(`Pyramided ${position.symbol} ${position.side} @ ${price} (entry ${position.entryCount + 1})`);
  }

  @Cron('*/5 * * * * *') // every 5 seconds
  async updatePositions() {
    if (!this.botRunning) return;

    const openPositions = await this.prisma.position.findMany({
      where: {
        status: { in: ['OPEN_LONG', 'LONG_TRAILING', 'OPEN_SHORT', 'SHORT_TRAILING'] },
      },
    });

    for (const position of openPositions) {
      await this.updatePosition(position);
    }
  }

  private async updatePosition(position: any) {
    const price = this.marketData.getLastPrice(position.symbol);
    if (price === 0) return;

    const config = this.botConfig.get();
    const isLong = position.side === 'LONG';
    let shouldClose = false;
    let exitReason = '';
    let updates: any = { currentPrice: price };

    if (isLong) {
      // Update highest price
      const newHighest = Math.max(position.highestPrice || price, price);
      updates.highestPrice = newHighest;

      // Calculate unrealized PnL
      const pnl = (price - position.avgEntryPrice) / position.avgEntryPrice * 100;
      updates.unrealizedPnl = (price - position.avgEntryPrice) * position.quantity;

      // Activate trailing
      const activationPrice = position.entryPrice * (1 + position.activationPct / 100);
      if (price >= activationPrice && position.status === 'OPEN_LONG') {
        updates.status = 'LONG_TRAILING';
        this.logger.debug(`${position.symbol} trailing activated @ ${price}`);
      }

      // Update trailing stop
      if (position.status === 'LONG_TRAILING' || updates.status === 'LONG_TRAILING') {
        const trailingStop = newHighest * (1 - position.trailingPct / 100);
        updates.trailingStop = trailingStop;

        if (price <= trailingStop) {
          shouldClose = true;
          exitReason = 'TRAILING_STOP';
        }
      }

      // Hard stop
      if (price <= position.hardStop) {
        shouldClose = true;
        exitReason = 'HARD_STOP';
      }
    } else {
      // SHORT
      const newLowest = Math.min(position.lowestPrice || price, price);
      updates.lowestPrice = newLowest;
      updates.unrealizedPnl = (position.avgEntryPrice - price) * position.quantity;

      const activationPrice = position.entryPrice * (1 - position.activationPct / 100);
      if (price <= activationPrice && position.status === 'OPEN_SHORT') {
        updates.status = 'SHORT_TRAILING';
      }

      if (position.status === 'SHORT_TRAILING' || updates.status === 'SHORT_TRAILING') {
        const trailingStop = newLowest * (1 + position.trailingPct / 100);
        updates.trailingStop = trailingStop;

        if (price >= trailingStop) {
          shouldClose = true;
          exitReason = 'TRAILING_STOP';
        }
      }

      if (price >= position.hardStop) {
        shouldClose = true;
        exitReason = 'HARD_STOP';
      }
    }

    if (shouldClose) {
      await this.closePosition(position, price, exitReason);
    } else {
      await this.prisma.position.update({
        where: { id: position.id },
        data: updates,
      });
    }
  }

  async closePosition(position: any, price?: number, exitReason = 'MANUAL') {
    const exitPrice = price || this.marketData.getLastPrice(position.symbol);
    if (exitPrice === 0) return;

    const isLong = position.side === 'LONG';
    const priceDiff = isLong
      ? exitPrice - position.avgEntryPrice
      : position.avgEntryPrice - exitPrice;

    const pnl = priceDiff * position.quantity;
    const pnlPct = (priceDiff / position.avgEntryPrice) * 100;
    const exitFee = exitPrice * position.quantity * FEE_RATE;
    const netPnl = pnl - exitFee;

    this.balance += netPnl;
    this.risk.updateDailyPnl(netPnl);

    const duration = Math.floor((Date.now() - new Date(position.openedAt).getTime()) / 1000);

    await this.prisma.position.update({
      where: { id: position.id },
      data: {
        status: 'CLOSED',
        exitPrice,
        exitReason,
        closedAt: new Date(),
        currentPrice: exitPrice,
        realizedPnl: pnl,
        unrealizedPnl: 0,
        fees: { increment: exitFee },
      },
    });

    await this.prisma.tradeHistory.create({
      data: {
        symbol: position.symbol,
        side: position.side,
        entryPrice: position.avgEntryPrice,
        exitPrice,
        quantity: position.quantity,
        pnl,
        pnlPct,
        fees: (position.fees || 0) + exitFee,
        duration,
        exitReason,
        entryTime: position.openedAt,
        exitTime: new Date(),
      },
    });

    // Update daily performance
    await this.updateDailyStats(pnl, exitFee, pnl > 0);

    await this.createNotification(
      'POSITION_CLOSED',
      `${position.side} position closed`,
      `${position.symbol} ${exitReason} PnL: $${netPnl.toFixed(2)}`,
    );

    this.logger.log(`Closed ${position.symbol} ${position.side} @ ${exitPrice} PnL: ${netPnl.toFixed(2)} (${exitReason})`);
    this.events.emit('position.closed', { position, pnl: netPnl });
  }

  async closeAllPositions() {
    const openPositions = await this.prisma.position.findMany({
      where: { status: { in: ['OPEN_LONG', 'LONG_TRAILING', 'OPEN_SHORT', 'SHORT_TRAILING'] } },
    });
    for (const pos of openPositions) {
      await this.closePosition(pos, undefined, 'EMERGENCY_CLOSE');
    }
  }

  private async updateDailyStats(pnl: number, fee: number, isWin: boolean) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    try {
      await this.prisma.performanceStat.upsert({
        where: { date: today },
        update: {
          dailyPnl: { increment: pnl },
          totalTrades: { increment: 1 },
          winningTrades: isWin ? { increment: 1 } : undefined,
          losingTrades: !isWin ? { increment: 1 } : undefined,
          totalFees: { increment: fee },
          equity: this.balance,
        },
        create: {
          date: today,
          dailyPnl: pnl,
          totalTrades: 1,
          winningTrades: isWin ? 1 : 0,
          losingTrades: isWin ? 0 : 1,
          totalFees: fee,
          equity: this.balance,
        },
      });
    } catch (err) {
      this.logger.error('Failed to update daily stats: ' + err.message);
    }
  }

  getBalance() {
    return this.balance;
  }

  async getOpenPositions() {
    return this.prisma.position.findMany({
      where: { status: { in: ['OPEN_LONG', 'LONG_TRAILING', 'OPEN_SHORT', 'SHORT_TRAILING'] } },
      orderBy: { openedAt: 'desc' },
    });
  }

  async getAllPositions(limit = 100) {
    return this.prisma.position.findMany({
      orderBy: { openedAt: 'desc' },
      take: limit,
    });
  }

  async getPosition(id: string) {
    return this.prisma.position.findUnique({
      where: { id: BigInt(id) },
      include: { orders: true },
    });
  }

  private async createNotification(type: string, title: string, message: string) {
    try {
      await this.prisma.notification.create({ data: { type, title, message } });
    } catch (err) {
      // ignore
    }
  }
}
