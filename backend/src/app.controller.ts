import {
  Controller, Get, Post, Put, Param, Body, Query, HttpException, HttpStatus
} from '@nestjs/common';
import { PositionEngineService } from './position-engine/position-engine.service';
import { SignalEngineService } from './signal-engine/signal-engine.service';
import { AnalyticsService } from './analytics/analytics.service';
import { RiskEngineService } from './risk-engine/risk-engine.service';
import { BotConfigService } from './config/bot-config.service';
import { MarketDataService } from './market-data/market-data.service';
import { PrismaService } from './prisma/prisma.service';

@Controller()
export class AppController {
  constructor(
    private readonly positions: PositionEngineService,
    private readonly signals: SignalEngineService,
    private readonly analytics: AnalyticsService,
    private readonly risk: RiskEngineService,
    private readonly botConfig: BotConfigService,
    private readonly marketData: MarketDataService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      database: 'connected',
      binance: this.marketData.isWsConnected() ? 'connected' : 'disconnected',
      websocket: this.marketData.isWsConnected(),
      lastMarketUpdate: this.marketData.getLastUpdate(),
      timestamp: new Date(),
    };
  }

  @Get('dashboard')
  async getDashboard() {
    const botStatus = this.positions.getBotStatus();
    const openPositions = await this.positions.getOpenPositions();
    const stats = await this.analytics.getSummaryStats();
    const riskStats = await this.risk.getStats();
    const tickers = this.marketData.getAllTickers();
    const unrealizedPnl = openPositions.reduce((s, p) => s + (Number(p.unrealizedPnl) || 0), 0);
    const equity = botStatus.balance + unrealizedPnl;

    const today = new Date(); today.setHours(0,0,0,0);
    const todayStats = await this.prisma.performanceStat.findUnique({ where: { date: today } });
    const weekAgo = new Date(Date.now() - 7*24*60*60*1000);
    const weekStats = await this.prisma.performanceStat.findMany({ where: { date: { gte: weekAgo } } });
    const weeklyPnl = weekStats.reduce((s, d) => s + d.dailyPnl, 0);
    const monthAgo = new Date(Date.now() - 30*24*60*60*1000);
    const monthStats = await this.prisma.performanceStat.findMany({ where: { date: { gte: monthAgo } } });
    const monthlyPnl = monthStats.reduce((s, d) => s + d.dailyPnl, 0);

    return {
      balance: botStatus.balance,
      equity,
      unrealizedPnl,
      dailyPnl: todayStats?.dailyPnl || riskStats.dailyPnl,
      weeklyPnl,
      monthlyPnl,
      winRate: stats.winRate,
      profitFactor: stats.profitFactor,
      totalTrades: stats.totalTrades,
      openPositionsCount: openPositions.length,
      botRunning: botStatus.running,
      botPaused: botStatus.paused,
      emergencyStop: riskStats.emergencyStop,
      tickers,
    };
  }

  @Get('positions')
  async getPositions(@Query('status') status?: string) {
    if (status === 'open') return this.positions.getOpenPositions();
    return this.positions.getAllPositions();
  }

  @Get('positions/:id')
  async getPosition(@Param('id') id: string) {
    const pos = await this.positions.getPosition(id);
    if (!pos) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    return pos;
  }

  @Post('positions/close')
  async closePosition(@Body() body: { id: string }) {
    const pos = await this.positions.getPosition(body.id);
    if (!pos) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    await this.positions.closePosition(pos, undefined, 'MANUAL');
    return { success: true };
  }

  @Get('trades')
  async getTrades(@Query('period') period: any = 'week') {
    return this.analytics.getRecentTrades(period);
  }

  @Get('signals')
  async getSignals(@Query('live') live?: string) {
    if (live === 'true') return this.signals.analyzeAll();
    return this.signals.getLatestSignals();
  }

  @Get('analytics')
  async getAnalytics(@Query('days') days?: string) {
    const d = days ? parseInt(days) : 30;
    const [equity, summary, dailyPnl, drawdown] = await Promise.all([
      this.analytics.getEquityCurve(d),
      this.analytics.getSummaryStats(),
      this.analytics.getDailyPnl(d),
      this.analytics.getDrawdown(d),
    ]);
    return { equity, summary, dailyPnl, drawdown };
  }

  @Get('risk')
  async getRisk() { return this.risk.getStats(); }

  @Get('config')
  getConfig() { return this.botConfig.get(); }

  @Put('config')
  async updateConfig(@Body() body: any) { return this.botConfig.update(body); }

  @Post('bot/start')
  async startBot() {
    this.positions.startBot();
    await this.botConfig.setTradingEnabled(true);
    return { status: 'started' };
  }

  @Post('bot/stop')
  async stopBot() {
    this.positions.stopBot();
    await this.botConfig.setTradingEnabled(false);
    return { status: 'stopped' };
  }

  @Post('bot/pause')
  pauseBot() { this.positions.pauseBot(); return { status: 'paused' }; }

  @Post('bot/resume')
  resumeBot() { this.positions.resumeBot(); return { status: 'resumed' }; }

  @Post('bot/close-all')
  async closeAll() { await this.positions.closeAllPositions(); return { success: true }; }

  @Post('bot/emergency-stop')
  async emergencyStop() {
    await this.risk.triggerEmergencyStop();
    await this.positions.closeAllPositions();
    this.positions.stopBot();
    return { status: 'emergency_stopped' };
  }

  @Get('notifications')
  async getNotifications() {
    return this.prisma.notification.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
  }

  @Post('notifications/mark-read')
  async markRead() {
    await this.prisma.notification.updateMany({ where: { read: false }, data: { read: true } });
    return { success: true };
  }

  @Get('market/tickers')
  getTickers() { return this.marketData.getAllTickers(); }

  @Get('market/candles/:symbol/:timeframe')
  getCandles(@Param('symbol') symbol: string, @Param('timeframe') timeframe: string, @Query('limit') limit?: string) {
    return this.marketData.getCandles(symbol, timeframe, limit ? parseInt(limit) : 100);
  }
}
