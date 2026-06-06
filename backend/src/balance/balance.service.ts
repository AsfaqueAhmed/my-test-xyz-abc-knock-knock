import { Injectable, BadRequestException, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type LedgerEntryType = 'DEPOSIT' | 'WITHDRAWAL' | 'TRADE_OPEN' | 'TRADE_CLOSE';

@Injectable()
export class BalanceService implements OnModuleInit {
  private readonly logger = new Logger(BalanceService.name);
  private cachedBalance = 0;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    const result = await this.prisma.balanceLedger.aggregate({ _sum: { amount: true } });
    this.cachedBalance = result._sum.amount ?? 0;
    this.logger.log(`Balance loaded: $${this.cachedBalance.toFixed(2)}`);
  }

  getBalance(): number {
    return this.cachedBalance;
  }

  async deposit(amount: number, description = 'Manual deposit') {
    if (amount <= 0) throw new BadRequestException('Deposit amount must be positive');
    return this.createEntry('DEPOSIT', amount, description);
  }

  async withdraw(amount: number, description = 'Manual withdrawal') {
    if (amount <= 0) throw new BadRequestException('Withdrawal amount must be positive');
    if (amount > this.cachedBalance) {
      throw new BadRequestException(`Insufficient balance ($${this.cachedBalance.toFixed(2)} available)`);
    }
    return this.createEntry('WITHDRAWAL', -amount, description);
  }

  async recordTradeOpen(symbol: string, positionId: bigint, fee: number): Promise<void> {
    await this.createEntry('TRADE_OPEN', -fee, `Entry fee — ${symbol}`, symbol, positionId);
  }

  async recordTradeClose(symbol: string, positionId: bigint, netPnl: number): Promise<void> {
    await this.createEntry('TRADE_CLOSE', netPnl, `Net PnL — ${symbol}`, symbol, positionId);
  }

  async getLedger(limit = 50, offset = 0) {
    const [entries, total] = await Promise.all([
      this.prisma.balanceLedger.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.balanceLedger.count(),
    ]);
    return { entries, total, balance: this.cachedBalance };
  }

  async getStats() {
    const rows = await this.prisma.balanceLedger.groupBy({
      by: ['type'],
      _sum: { amount: true },
      _count: { id: true },
    });

    const by: Record<string, { sum: number; count: number }> = {};
    for (const r of rows) by[r.type] = { sum: r._sum.amount ?? 0, count: r._count.id };

    return {
      currentBalance: this.cachedBalance,
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
    symbol?: string,
    positionId?: bigint,
  ) {
    this.cachedBalance += amount;
    return this.prisma.balanceLedger.create({
      data: {
        type,
        amount,
        balanceAfter: this.cachedBalance,
        description,
        symbol:     symbol     ?? null,
        positionId: positionId ?? null,
      },
    });
  }
}
