import { Controller, Get, Post, Put, Param, Body, Query, HttpException, HttpStatus, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
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
import { BalanceService } from './balance/balance.service';

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
    private readonly balanceService: BalanceService,
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

    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const weekAgo = new Date(Date.now() - 7*24*60*60*1000);
    const monthAgo = new Date(Date.now() - 30*24*60*60*1000);

    const [todayTrades, weekTrades, monthTrades] = await Promise.all([
      this.prisma.tradeHistory.findMany({ where: { exitTime: { gte: today } }, select: { pnl: true, fees: true } }),
      this.prisma.tradeHistory.findMany({ where: { exitTime: { gte: weekAgo } }, select: { pnl: true, fees: true } }),
      this.prisma.tradeHistory.findMany({ where: { exitTime: { gte: monthAgo } }, select: { pnl: true, fees: true } }),
    ]);

    const netPnl = (trades: { pnl: number; fees: number }[]) =>
      trades.reduce((s, t) => s + t.pnl - t.fees, 0);

    const freeMargin = balance - investedBalance;
    const tickers = this.getStoredTokenList().filter(t => t.price > 0).slice(0, 20);

    return {
      balance,
      investedBalance,
      freeMargin,
      equity,
      unrealizedPnl,
      dailyPnl: netPnl(todayTrades),
      weeklyPnl: netPnl(weekTrades),
      monthlyPnl: netPnl(monthTrades),
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
    const { candidates, scannedAt } = this.portfolio.getLastCandidates();
    return { candidates, scannedAt };
  }

  @Get('portfolio/exec-check/:symbol')
  async execCheck(
    @Param('symbol') symbol: string,
    @Query('direction') direction = 'LONG',
  ) {
    const sym = symbol.toUpperCase();
    const side = direction.toUpperCase() as 'LONG' | 'SHORT';
    const cfg = this.botConfig.get();
    const botStatus = this.portfolio.getStatus();
    const balance = this.balanceService.getBalance();
    const blockers: string[] = [];

    if (!botStatus.running) blockers.push('Bot is not running');
    else if (botStatus.paused) blockers.push('Bot is paused');
    else if (!cfg.tradingEnabled) blockers.push('Trading disabled');

    if (this.risk.isEmergencyStop()) blockers.push('Emergency stop active');

    const effectiveCapital = Math.min(cfg.maxCapitalPerEntry, balance * 0.1);
    const riskCheck = await this.risk.checkRisk(sym, side, effectiveCapital);
    if (!riskCheck.allowed) blockers.push(riskCheck.reason!);

    const cooldown = await this.risk.checkCooldown(sym);
    if (!cooldown.allowed) blockers.push(cooldown.reason!);

    const price = this.scanner.getCurrentPrice(sym);
    if (price <= 0) blockers.push(`Price unavailable for ${sym}`);

    if (effectiveCapital <= 0) blockers.push(`Insufficient balance ($${balance.toFixed(2)})`);

    return { symbol: sym, direction: side, blockers, canTrade: blockers.length === 0 };
  }

  @Get('portfolio/execution-state')
  async getExecutionState() {
    const cfg = this.botConfig.get();
    const botStatus = this.portfolio.getStatus();
    const balance = this.balanceService.getBalance();
    const riskStats = await this.risk.getStats();
    const effectiveCapital = Math.min(cfg.maxCapitalPerEntry, balance * 0.1);

    // Determine what's blocking execution
    const blockers: string[] = [];
    if (!botStatus.running) blockers.push('Bot is stopped');
    else if (botStatus.paused) blockers.push('Bot is paused');
    else if (!cfg.tradingEnabled) blockers.push('Trading disabled in config');

    if (riskStats.emergencyStop) blockers.push('Emergency stop active');
    if (riskStats.dailyPnl < 0) {
      const drawdownPct = balance > 0 ? Math.abs(riskStats.dailyPnl) / balance * 100 : 0;
      if (drawdownPct >= cfg.maxDailyDrawdownPct)
        blockers.push(`Daily drawdown limit hit (${drawdownPct.toFixed(2)}% / ${cfg.maxDailyDrawdownPct}%)`);
    }
    if (riskStats.openPositions >= cfg.maxActivePositions) {
      if (!cfg.replacementEnabled)
        blockers.push(`Slots full (${riskStats.openPositions}/${cfg.maxActivePositions}) — replacement disabled`);
      else
        blockers.push(`Slots full (${riskStats.openPositions}/${cfg.maxActivePositions}) — replacement active (threshold +${cfg.replacementThreshold})`);
    }
    if (effectiveCapital <= 0) blockers.push(`Insufficient balance ($${balance.toFixed(2)})`);

    return {
      botRunning: botStatus.running,
      botPaused: botStatus.paused,
      tradingEnabled: cfg.tradingEnabled,
      balance,
      effectiveCapital,
      openPositions: riskStats.openPositions,
      maxPositions: cfg.maxActivePositions,
      slotsAvailable: Math.max(cfg.maxActivePositions - riskStats.openPositions, 0),
      replacementEnabled: cfg.replacementEnabled,
      replacementThreshold: cfg.replacementThreshold,
      emergencyStop: riskStats.emergencyStop,
      dailyPnl: riskStats.dailyPnl,
      maxDailyDrawdownPct: cfg.maxDailyDrawdownPct,
      activeCooldowns: riskStats.cooldowns.map((c: any) => ({
        symbol: c.symbol,
        reason: c.reason,
        endsAt: c.endsAt,
      })),
      blockers,
      canTrade: blockers.length === 0,
    };
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

  // ─── Manual Trading ───────────────────────────────────────────────────────

  @Get('trades/manual/check/:symbol')
  async checkManualTrade(
    @Param('symbol') symbol: string,
    @Query('direction') direction: string = 'LONG',
  ) {
    const dir = direction.toUpperCase() as 'LONG' | 'SHORT';
    if (!['LONG', 'SHORT'].includes(dir))
      throw new HttpException('direction must be LONG or SHORT', HttpStatus.BAD_REQUEST);
    try {
      return await this.positions.checkManual(symbol.toUpperCase(), dir);
    } catch (err) {
      throw new HttpException(err.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Post('trades/manual')
  async manualTrade(@Body() body: { symbol: string; direction: 'LONG' | 'SHORT'; amount?: number }) {
    const { symbol, direction, amount } = body;
    if (!symbol || !direction)
      throw new HttpException('symbol and direction are required', HttpStatus.BAD_REQUEST);
    const dir = direction.toUpperCase() as 'LONG' | 'SHORT';
    if (!['LONG', 'SHORT'].includes(dir))
      throw new HttpException('direction must be LONG or SHORT', HttpStatus.BAD_REQUEST);
    try {
      return await this.positions.manualOpen(symbol.toUpperCase(), dir, amount);
    } catch (err) {
      throw new HttpException(err.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Get('market/tokens')
  @Get('market/token-list')
  getMarketTokens() {
    return this.getStoredTokenList();
  }

  // ─── Balance ──────────────────────────────────────────────────────────────

  @Get('balance')
  async getBalance() {
    return this.balanceService.getStats();
  }

  @Get('balance/ledger')
  async getBalanceLedger(
    @Query('limit',  new DefaultValuePipe(50),  ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0),   ParseIntPipe) offset: number,
  ) {
    return this.balanceService.getLedger(limit, offset);
  }

  @Post('balance/deposit')
  async deposit(@Body() body: { amount: number; description?: string }) {
    if (!body.amount) throw new HttpException('amount is required', HttpStatus.BAD_REQUEST);
    try {
      return await this.balanceService.deposit(body.amount, body.description);
    } catch (err) {
      throw new HttpException(err.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Post('balance/withdraw')
  async withdraw(@Body() body: { amount: number; description?: string }) {
    if (!body.amount) throw new HttpException('amount is required', HttpStatus.BAD_REQUEST);
    try {
      return await this.balanceService.withdraw(body.amount, body.description);
    } catch (err) {
      throw new HttpException(err.message, HttpStatus.BAD_REQUEST);
    }
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
