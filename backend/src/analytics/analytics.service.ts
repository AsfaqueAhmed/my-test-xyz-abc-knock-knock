import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getEquityCurve(days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    
    const stats = await this.prisma.performanceStat.findMany({
      where: { date: { gte: since } },
      orderBy: { date: 'asc' },
    });

    return stats.map(s => ({
      date: s.date.toISOString().split('T')[0],
      equity: s.equity,
      dailyPnl: s.dailyPnl,
    }));
  }

  async getSummaryStats() {
    const trades = await this.prisma.tradeHistory.findMany();
    
    if (trades.length === 0) {
      return {
        totalTrades: 0,
        winRate: 0,
        profitFactor: 0,
        avgTrade: 0,
        largestWinner: 0,
        largestLoser: 0,
        totalPnl: 0,
        totalFees: 0,
        avgDuration: 0,
        sharpeRatio: 0,
      };
    }

    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);
    const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
    const totalFees = trades.reduce((s, t) => s + t.fees, 0);
    const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

    return {
      totalTrades: trades.length,
      winRate: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0,
      avgTrade: totalPnl / trades.length,
      largestWinner: wins.length > 0 ? Math.max(...wins.map(t => t.pnl)) : 0,
      largestLoser: losses.length > 0 ? Math.min(...losses.map(t => t.pnl)) : 0,
      totalPnl,
      totalFees,
      avgDuration: trades.reduce((s, t) => s + t.duration, 0) / trades.length,
    };
  }

  async getRecentTrades(period: 'today' | 'week' | 'month' | 'all' = 'week') {
    let since: Date | undefined;
    const now = new Date();
    
    if (period === 'today') {
      since = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === 'week') {
      since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === 'month') {
      since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    return this.prisma.tradeHistory.findMany({
      where: since ? { exitTime: { gte: since } } : undefined,
      orderBy: { exitTime: 'desc' },
      take: 200,
    });
  }

  async getDailyPnl(days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    
    return this.prisma.performanceStat.findMany({
      where: { date: { gte: since } },
      orderBy: { date: 'asc' },
      select: { date: true, dailyPnl: true, totalTrades: true, winningTrades: true },
    });
  }

  async getDrawdown(days = 30) {
    const stats = await this.getEquityCurve(days);
    let peak = 0;
    let maxDrawdown = 0;
    
    return stats.map(s => {
      if (s.equity > peak) peak = s.equity;
      const dd = peak > 0 ? ((peak - s.equity) / peak) * 100 : 0;
      if (dd > maxDrawdown) maxDrawdown = dd;
      return { date: s.date, drawdown: dd, maxDrawdown };
    });
  }
}
