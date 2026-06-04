import { Controller, Get, Post, Put, Param, Body, Query, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PositionEngineService } from './position-engine/position-engine.service';
import { AnalyticsService } from './analytics/analytics.service';
import { RiskEngineService } from './risk-engine/risk-engine.service';
import { BotConfigService } from './config/bot-config.service';
import { MarketScannerService } from './market-scanner/market-scanner.service';
import { MomentumRankerService } from './momentum-ranker/momentum-ranker.service';
import { PortfolioManagerService } from './portfolio-manager/portfolio-manager.service';
import { PrismaService } from './prisma/prisma.service';
import { BotLogService } from './bot-log/bot-log.service';

@Controller()
@ApiTags('Trading Platform')
export class AppController {
  constructor(
    private readonly positions: PositionEngineService,
    private readonly analytics: AnalyticsService,
    private readonly risk: RiskEngineService,
    private readonly botConfig: BotConfigService,
    private readonly scanner: MarketScannerService,
    private readonly ranker: MomentumRankerService,
    private readonly portfolio: PortfolioManagerService,
    private readonly prisma: PrismaService,
    private readonly botLog: BotLogService,
    private readonly events: EventEmitter2,
  ) {}

  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      database: 'connected',
      binance: this.scanner.isConnected() ? 'connected' : 'disconnected',
      websocket: this.scanner.isConnected(),
      lastMarketUpdate: this.scanner.getLastUpdate(),
      symbolCount: this.scanner.getSymbolCount(),
      scanTurn: this.scanner.getScanTurn(),
      timestamp: new Date(),
    };
  }

  @Get('dashboard')
  async getDashboard() {
    const botStatus = this.portfolio.getStatus();
    const balance = this.positions.getBalance();
    const openPositions = await this.positions.getOpenPositions();
    const stats = await this.analytics.getSummaryStats();
    const riskStats = await this.risk.getStats();
    const unrealizedPnl = openPositions.reduce((s, p) => s + Number(p.unrealizedPnl || 0), 0);
    const investedBalance = openPositions.reduce((s, p) => {
      const notional = Number(p.avgEntryPrice) * Number(p.quantity);
      return s + notional / (Number(p.leverage) || 1);
    }, 0);
    const equity = balance + unrealizedPnl;

    const today = new Date(); today.setHours(0,0,0,0);
    const todayStats = await this.prisma.performanceStat.findUnique({ where: { date: today } });
    const weekAgo = new Date(Date.now() - 7*24*60*60*1000);
    const weekStats = await this.prisma.performanceStat.findMany({ where: { date: { gte: weekAgo } } });
    const monthAgo = new Date(Date.now() - 30*24*60*60*1000);
    const monthStats = await this.prisma.performanceStat.findMany({ where: { date: { gte: monthAgo } } });
    const tickers = this.getStoredTokenList().filter(t => t.price > 0).slice(0, 20);

    return {
      balance,
      investedBalance,
      equity,
      unrealizedPnl,
      dailyPnl: todayStats?.dailyPnl ?? riskStats.dailyPnl,
      weeklyPnl: weekStats.reduce((s, d) => s + d.dailyPnl, 0),
      monthlyPnl: monthStats.reduce((s, d) => s + d.dailyPnl, 0),
      winRate: stats.winRate,
      profitFactor: stats.profitFactor,
      totalTrades: stats.totalTrades,
      openPositionsCount: openPositions.length,
      botRunning: botStatus.running,
      botPaused: botStatus.paused,
      emergencyStop: riskStats.emergencyStop,
      tickers,
      symbolCount: this.scanner.getSymbolCount(),
      scanTurn: this.scanner.getScanTurn(),
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
  async getSignals() {
    return this.prisma.signal.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  }

  // Live scanner state
  @Get('scanner/ranking')
  getRanking() {
    return {
      topBullish: this.ranker.getTopBullish(),
      topBearish: this.ranker.getTopBearish(),
      turn: this.scanner.getScanTurn(),
    };
  }

  @Get('scanner/scores')
  getScores(@Query('limit') limit?: string) {
    const all = this.ranker.getAllScores();
    const n = limit ? parseInt(limit) : 50;
    return all
      .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
      .slice(0, n);
  }

  @Get('scanner/false-alarms')
  getFalseAlarms() {
    return this.ranker.getAllFalseAlarms().filter(f => f.offenseCount > 0 || f.consecutiveFailures > 0);
  }

  @Get('portfolio/scores')
  getPortfolioScores() {
    return this.portfolio.getPositionScores();
  }

  @Get('portfolio/candidates')
  getCandidates() {
    return this.portfolio.getLastCandidates();
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
  async updateConfig(@Body() body: any) {
    const result = await this.botConfig.update(body);
    this.scanner.restartTimers();
    return result;
  }

  @Post('bot/start')
  async startBot() {
    await this.portfolio.start('MANUAL');
    return { status: 'started' };
  }

  @Post('bot/stop')
  async stopBot() {
    await this.portfolio.stop('MANUAL');
    return { status: 'stopped' };
  }

  @Post('bot/pause')
  async pauseBot() { await this.portfolio.pause('MANUAL'); return { status: 'paused' }; }

  @Post('bot/resume')
  async resumeBot() { await this.portfolio.resume('MANUAL'); return { status: 'resumed' }; }

  @Post('bot/close-all')
  async closeAll() { await this.positions.closeAllPositions(); return { success: true }; }

  @Post('bot/emergency-stop')
  async emergencyStop() {
    await this.risk.triggerEmergencyStop();
    await this.positions.closeAllPositions();
    this.portfolio.stop('EMERGENCY_STOP', 'Emergency stop triggered by user');
    this.events.emit('bot.emergencyStopped', { triggeredBy: 'MANUAL' });
    return { status: 'emergency_stopped' };
  }

  @Get('logs')
  async getLogs(
    @Query('limit')    limit?: string,
    @Query('category') category?: string,
    @Query('level')    level?: string,
    @Query('symbol')   symbol?: string,
    @Query('event')    event?: string,
  ) {
    return this.botLog.getLogs({
      limit:    limit    ? parseInt(limit) : 200,
      category: category || undefined,
      level:    level    || undefined,
      symbol:   symbol   || undefined,
      event:    event    || undefined,
    });
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
  getTickers() { return this.scanner.getAllTickers(); }

  @Get('market/history/:symbol')
  getSymbolHistory(@Param('symbol') symbol: string) {
    const sym = symbol.toUpperCase();
    return this.scanner.getPriceHistory(sym);
  }

  @Get('market/tokens')
  @Get('market/token-list')
  getMarketTokens() {
    return this.getStoredTokenList();
  }

  private getStoredTokenList() {
    const scoreBySymbol = new Map(this.ranker.getAllScores().map(s => [s.symbol, s]));
    return this.scanner.getAllSymbols().map(symbol => {
      const ticker = this.scanner.getTicker(symbol);
      const score = scoreBySymbol.get(symbol);
      return {
        name: ticker?.name || this.scanner.getTokenName(symbol),
        symbol,
        price: ticker?.price ?? 0,
        change30s: score?.changes.s30 ?? 0,
        change1m: score?.changes.m1 ?? 0,
        change2m: score?.changes.m2 ?? 0,
        change5m: score?.changes.m5 ?? 0,
        change10m: score?.changes.m10 ?? 0,
        change15m: score?.changes.m15 ?? 0,
        change30m: score?.changes.m30 ?? 0,
        change24h: ticker?.change24h ?? 0,
        volume24h: ticker?.volume24h ?? 0,
        updatedAt: ticker?.updatedAt ?? null,
      };
    });
  }
}
