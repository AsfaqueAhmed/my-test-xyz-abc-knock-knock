import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';

type Level    = 'INFO' | 'WARN' | 'ERROR';
type Category = 'BOT' | 'POSITION' | 'RISK' | 'SYSTEM';

@Injectable()
export class BotLogService {
  private readonly logger = new Logger(BotLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async write(
    level: Level,
    category: Category,
    event: string,
    message: string,
    symbol?: string,
    metadata?: Record<string, unknown>,
  ) {
    try {
      await this.prisma.botLog.create({
        data: {
          level,
          category,
          event,
          symbol: symbol ?? null,
          message,
          metadata: metadata ? JSON.stringify(metadata) : null,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to write bot log: ${err.message}`);
    }
  }

  // ─── Bot Control ──────────────────────────────────────────────────────────

  @OnEvent('bot.started')
  onBotStarted({ triggeredBy }: { triggeredBy: string }) {
    void this.write('INFO', 'BOT', 'BOT_STARTED', 'Bot started', undefined, { triggeredBy });
  }

  @OnEvent('bot.stopped')
  onBotStopped({ triggeredBy, reason }: { triggeredBy: string; reason?: string }) {
    void this.write('INFO', 'BOT', 'BOT_STOPPED', 'Bot stopped', undefined, { triggeredBy, reason });
  }

  @OnEvent('bot.paused')
  onBotPaused({ triggeredBy }: { triggeredBy: string }) {
    void this.write('INFO', 'BOT', 'BOT_PAUSED', 'Bot paused', undefined, { triggeredBy });
  }

  @OnEvent('bot.resumed')
  onBotResumed({ triggeredBy }: { triggeredBy: string }) {
    void this.write('INFO', 'BOT', 'BOT_RESUMED', 'Bot resumed', undefined, { triggeredBy });
  }

  @OnEvent('bot.emergencyStopped')
  onEmergencyStopped({ triggeredBy }: { triggeredBy: string }) {
    void this.write('ERROR', 'BOT', 'EMERGENCY_STOP', 'Emergency stop triggered', undefined, { triggeredBy });
  }

  // ─── Position Events ──────────────────────────────────────────────────────

  @OnEvent('position.opened')
  onPositionOpened({ position, candidate }: { position: any; candidate?: any }) {
    const meta: Record<string, unknown> = {
      side:     position.side,
      price:    Number(position.entryPrice),
      quantity: Number(position.quantity),
      leverage: Number(position.leverage),
      hardStop: Number(position.hardStop),
    };
    if (candidate) {
      meta.score         = candidate.tradeScore;
      meta.momentumScore = candidate.momentumScore;
      meta.trendScore    = candidate.trendScore;
      meta.volumeScore   = candidate.volumeScore;
      meta.breakoutScore = candidate.breakoutScore;
      meta.reasons       = candidate.reasons;
    }
    void this.write(
      'INFO', 'POSITION', 'POSITION_OPENED',
      `${position.side} opened on ${position.symbol} @ $${Number(position.entryPrice).toFixed(4)}`,
      position.symbol,
      meta,
    );
  }

  @OnEvent('position.pyramided')
  onPositionPyramided({ symbol, side, price, newAvgEntry, entryCount }: any) {
    void this.write(
      'INFO', 'POSITION', 'POSITION_PYRAMIDED',
      `Pyramid entry #${entryCount} on ${symbol} ${side} @ $${Number(price).toFixed(4)}`,
      symbol,
      { side, price, newAvgEntry, entryCount },
    );
  }

  @OnEvent('position.closed')
  onPositionClosed({ pos, pnl, exitReason, exitPrice, pnlPct, duration }: any) {
    const level: Level  = exitReason === 'HARD_STOP' ? 'WARN' : 'INFO';
    const sign          = pnl >= 0 ? '+' : '-';
    const pnlStr        = `${sign}$${Math.abs(pnl).toFixed(2)}`;
    void this.write(
      level, 'POSITION', 'POSITION_CLOSED',
      `${pos.side} closed on ${pos.symbol} | ${exitReason} | PnL: ${pnlStr}`,
      pos.symbol,
      {
        side: pos.side,
        exitReason,
        exitPrice,
        avgEntryPrice: Number(pos.avgEntryPrice),
        pnl,
        pnlPct,
        duration,
      },
    );
  }

  @OnEvent('position.replaced')
  onPositionReplaced({ closedSymbol, closedScore, newSymbol, newScore, opportunityScore }: any) {
    void this.write(
      'WARN', 'POSITION', 'POSITION_REPLACED',
      `${closedSymbol} (score ${Number(closedScore).toFixed(1)}) replaced by ${newSymbol} (score ${Number(newScore).toFixed(1)}, +${Number(opportunityScore).toFixed(1)})`,
      newSymbol,
      { closedSymbol, closedScore, newSymbol, newScore, opportunityScore },
    );
  }

  // ─── Risk Events ──────────────────────────────────────────────────────────

  @OnEvent('falseAlarm.triggered')
  onFalseAlarm({ symbol, offenseCount, cooldownTurns, cooldownEndsAtTurn, threshold, reason }: any) {
    const description =
      `Ranked in top candidates ${threshold} times in a row without passing validation. ` +
      `Last failure: "${reason}". ` +
      `This is offense #${offenseCount} — symbol is blocked for ${cooldownTurns} scan turns.`;

    void this.write(
      'WARN', 'RISK', 'FALSE_ALARM',
      `${symbol} — false alarm #${offenseCount} · blocked ${cooldownTurns} turns · ${reason}`,
      symbol,
      { offenseCount, cooldownTurns, cooldownEndsAtTurn, threshold, reason, description },
    );
  }

  @OnEvent('risk.dailyLossLimit')
  onDailyLossLimit({ currentLoss, limit }: any) {
    void this.write(
      'ERROR', 'RISK', 'DAILY_LOSS_LIMIT',
      `Daily loss limit hit: $${Math.abs(currentLoss).toFixed(2)} / $${Number(limit).toFixed(2)}`,
      undefined,
      { currentLoss, limit },
    );
  }

  @OnEvent('risk.cooldown')
  onCooldown({ symbol, reason }: any) {
    void this.write('WARN', 'RISK', 'COOLDOWN_ACTIVATED', `Cooldown on ${symbol}: ${reason}`, symbol, { reason });
  }

  // ─── Public write API ────────────────────────────────────────────────────

  log(
    level: Level,
    category: Category,
    event: string,
    message: string,
    symbol?: string,
    metadata?: Record<string, unknown>,
  ) {
    void this.write(level, category, event, message, symbol, metadata);
  }

  // ─── Public query API (used by controller) ────────────────────────────────

  async getLogs(opts: {
    limit?: number;
    category?: string;
    level?: string;
    symbol?: string;
    event?: string;
  }) {
    const where: any = {};
    if (opts.category) where.category = opts.category;
    if (opts.level)    where.level    = opts.level;
    if (opts.symbol)   where.symbol   = opts.symbol;
    if (opts.event)    where.event    = opts.event;

    const rows = await this.prisma.botLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: opts.limit ?? 200,
    });

    return rows.map(r => ({
      ...r,
      id:       r.id.toString(),
      metadata: r.metadata ? JSON.parse(r.metadata) : null,
    }));
  }
}
