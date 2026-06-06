import { Injectable, BadRequestException, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BotConfigService } from '../config/bot-config.service';

export type LedgerEntryType = 'DEPOSIT' | 'WITHDRAWAL' | 'TRADE_OPEN' | 'TRADE_CLOSE';
export type TradingMode = 'PAPER' | 'TESTNET' | 'LIVE';

const MODES: TradingMode[] = ['PAPER', 'TESTNET', 'LIVE'];

@Injectable()
export class BalanceService implements OnModuleInit {
  private readonly logger = new Logger(BalanceService.name);
  private balances: Record<TradingMode, number> = { PAPER: 0, TESTNET: 0, LIVE: 0 };

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: BotConfigService,
  ) {}

  async onModuleInit() {
    for (const mode of MODES) {
      const result = await this.prisma.balanceLedger.aggregate({
        _sum: { amount: true },
        where: { mode },
      });
      this.balances[mode] = result._sum.amount ?? 0;
    }
    this.logger.log(
      `Balances — PAPER: $${this.balances.PAPER.toFixed(2)} | TESTNET: $${this.balances.TESTNET.toFixed(2)} | LIVE: $${this.balances.LIVE.toFixed(2)}`
    );
  }

  // Returns the balance for the currently active trading mode (or explicit mode)
  getBalance(mode?: TradingMode): number {
    return this.balances[mode ?? this.config.getMode()];
  }

  getAllBalances(): Record<TradingMode, number> {
    return { ...this.balances };
  }

  async deposit(amount: number, description = 'Manual deposit') {
    if (amount <= 0) throw new BadRequestException('Deposit amount must be positive');
    return this.createEntry('DEPOSIT', amount, description);
  }

  async withdraw(amount: number, description = 'Manual withdrawal') {
    if (amount <= 0) throw new BadRequestException('Withdrawal amount must be positive');
    const mode = this.config.getMode();
    if (amount > this.balances[mode]) {
      throw new BadRequestException(`Insufficient balance ($${this.balances[mode].toFixed(2)} available in ${mode} mode)`);
    }
    return this.createEntry('WITHDRAWAL', -amount, description);
  }

  async syncTo(targetBalance: number, description = 'Balance sync from exchange') {
    const mode = this.config.getMode();
    const diff = targetBalance - this.balances[mode];
    if (Math.abs(diff) < 0.01) return this.balances[mode];
    await this.createEntry(diff > 0 ? 'DEPOSIT' : 'WITHDRAWAL', diff, description);
    return this.balances[mode];
  }

  async recordTradeOpen(symbol: string, positionId: bigint, fee: number, mode?: TradingMode): Promise<void> {
    await this.createEntry('TRADE_OPEN', -fee, `Entry fee — ${symbol}`, mode, symbol, positionId);
  }

  async recordTradeClose(symbol: string, positionId: bigint, netPnl: number, mode?: TradingMode): Promise<void> {
    await this.createEntry('TRADE_CLOSE', netPnl, `Net PnL — ${symbol}`, mode, symbol, positionId);
  }

  async getLedger(limit = 50, offset = 0) {
    const mode = this.config.getMode();
    const [entries, total] = await Promise.all([
      this.prisma.balanceLedger.findMany({
        where: { mode },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.balanceLedger.count({ where: { mode } }),
    ]);
    return { entries, total, balance: this.balances[mode], mode };
  }

  async getStats() {
    const mode = this.config.getMode();
    const rows = await this.prisma.balanceLedger.groupBy({
      by: ['type'],
      where: { mode },
      _sum: { amount: true },
      _count: { id: true },
    });

    const by: Record<string, { sum: number; count: number }> = {};
    for (const r of rows) by[r.type] = { sum: r._sum.amount ?? 0, count: r._count.id };

    return {
      mode,
      currentBalance: this.balances[mode],
      allBalances: this.getAllBalances(),
      totalDeposited: by['DEPOSIT']?.sum ?? 0,
      totalWithdrawn: Math.abs(by['WITHDRAWAL']?.sum ?? 0),
      totalPnl:       by['TRADE_CLOSE']?.sum ?? 0,
      totalFees:      Math.abs(by['TRADE_OPEN']?.sum ?? 0),
      tradeCount:     by['TRADE_CLOSE']?.count ?? 0,
    };
  }

  private async createEntry(
    type: LedgerEntryType,
    amount: number,
    description: string,
    mode?: TradingMode,
    symbol?: string,
    positionId?: bigint,
  ) {
    const m = mode ?? this.config.getMode();
    this.balances[m] += amount;
    return this.prisma.balanceLedger.create({
      data: {
        type,
        amount,
        balanceAfter: this.balances[m],
        mode: m,
        description,
        symbol:     symbol     ?? null,
        positionId: positionId ?? null,
      },
    });
  }
}
