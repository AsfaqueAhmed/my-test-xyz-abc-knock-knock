import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BotConfigService } from '../config/bot-config.service';
import { BalanceService } from '../balance/balance.service';

export interface RiskCheck {
  allowed: boolean;
  reason?: string;
  /** When exposure headroom is less than requested capital, this is the reduced capital to use */
  reducedCapital?: number;
}

export interface RiskCheckOptions {
  ignorePositionLimit?: boolean;
}

@Injectable()
export class RiskEngineService {
  private readonly logger = new Logger(RiskEngineService.name);
  private dailyPnl = 0;
  private emergencyStop = false;
  private currentDayStartUtc = RiskEngineService.utcMidnight();

  constructor(
    private readonly prisma: PrismaService,
    private readonly botConfig: BotConfigService,
    private readonly balanceService: BalanceService,
  ) {}

  // Returns the ms timestamp of today's UTC midnight — stable, locale-independent.
  private static utcMidnight(): number {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  }

  async checkDailyReset() {
    const todayStart = RiskEngineService.utcMidnight();
    if (todayStart !== this.currentDayStartUtc) {
      this.dailyPnl = 0;
      this.currentDayStartUtc = todayStart;
    }
  }

  async checkRisk(
    symbol: string,
    side: 'LONG' | 'SHORT',
    capital: number,
    options: RiskCheckOptions = {},
  ): Promise<RiskCheck> {
    await this.checkDailyReset();
    const config = this.botConfig.get();

    if (this.emergencyStop) {
      return { allowed: false, reason: 'Emergency stop active' };
    }

    // Daily drawdown check
    if (this.dailyPnl < 0) {
      const balance = this.balanceService.getBalance();
      const drawdownPct = balance > 0 ? Math.abs(this.dailyPnl) / balance * 100 : 0;
      if (drawdownPct >= config.maxDailyDrawdownPct) {
        await this.logRiskEvent('DAILY_DRAWDOWN', `Daily drawdown ${drawdownPct.toFixed(2)}% exceeds limit`, 'HIGH');
        return { allowed: false, reason: `Daily drawdown limit reached (${drawdownPct.toFixed(2)}%)` };
      }
    }

    const mode = this.botConfig.getMode();

    // Check open positions count
    const openPositions = await this.prisma.position.count({
      where: { status: { in: ['OPEN_LONG', 'LONG_TRAILING', 'OPEN_SHORT', 'SHORT_TRAILING'] }, mode },
    });

    if (!options.ignorePositionLimit && openPositions >= config.maxActivePositions) {
      return { allowed: false, reason: `Max active positions reached (${openPositions}/${config.maxActivePositions})` };
    }

    const balance = this.balanceService.getBalance();
    const exposure = await this.getCurrentExposure(mode);
    const newNotional = capital * config.leverage;
    const maxExposure = balance * (config.maxExposurePct / 100);
    if (config.exposureCheckEnabled && exposure + newNotional > maxExposure) {
      const headroom = maxExposure - exposure;
      const reducedCapital = headroom / config.leverage;
      const minReducedCapital = capital * 0.5;
      if (headroom > 0 && reducedCapital >= minReducedCapital) {
        return { allowed: true, reducedCapital };
      }
      return {
        allowed: false,
        reason:
          `Exposure limit: open positions $${exposure.toFixed(2)} + this trade $${newNotional.toFixed(2)} = $${(exposure + newNotional).toFixed(2)} — ` +
          `limit is $${maxExposure.toFixed(2)} (balance $${balance.toFixed(2)} × ${config.maxExposurePct}%). ` +
          (headroom > 0
            ? `Only $${headroom.toFixed(2)} headroom left, need at least 50% of intended capital ($${minReducedCapital.toFixed(2)}).`
            : `No headroom — existing positions already exceed the limit.`),
      };
    }

    // Only one open position record per symbol at a time.
    // Pyramid entries are tracked inside that record via entryCount, not as separate rows.
    const symbolPositions = await this.prisma.position.count({
      where: {
        symbol, mode,
        status: { in: ['OPEN_LONG', 'LONG_TRAILING', 'OPEN_SHORT', 'SHORT_TRAILING'] },
      },
    });

    if (symbolPositions > 0) {
      return { allowed: false, reason: `Position already open for ${symbol}` };
    }

    return { allowed: true };
  }

  async checkCooldown(symbol: string): Promise<RiskCheck> {
    const now = new Date();
    const mode = this.botConfig.getMode();
    const activeCooldown = await this.prisma.cooldownEvent.findFirst({
      where: {
        symbol, mode,
        active: true,
        endsAt: { gt: now },
      },
    });

    if (activeCooldown) {
      const remaining = Math.ceil((activeCooldown.endsAt.getTime() - now.getTime()) / 1000 / 60);
      return { allowed: false, reason: `Cooldown active for ${remaining} more minutes` };
    }

    return { allowed: true };
  }

  async trackEntry(symbol: string) {
    const config = this.botConfig.get();
    const mode = this.botConfig.getMode();
    const windowMs = config.cooldownWindowMin * 60 * 1000;
    const since = new Date(Date.now() - windowMs);

    const recentEntries = await this.prisma.position.count({
      where: { symbol, mode, openedAt: { gte: since } },
    });

    if (recentEntries >= config.cooldownEntries) {
      const endsAt = new Date(Date.now() + config.cooldownDurationMin * 60 * 1000);
      await this.prisma.cooldownEvent.create({
        data: { symbol, mode, reason: `${recentEntries} entries in ${config.cooldownWindowMin} minutes`, startsAt: new Date(), endsAt, active: true },
      });
      this.logger.warn(`Cooldown activated for ${symbol} [${mode}]`);
    }
  }

  // Returns total notional value of all open positions (avgEntryPrice × quantity).
  // quantity is already the leveraged size, so this correctly reflects actual market exposure.
  private async getCurrentExposure(mode?: string): Promise<number> {
    const m = mode ?? this.botConfig.getMode();
    const openPositions = await this.prisma.position.findMany({
      where: { status: { in: ['OPEN_LONG', 'LONG_TRAILING', 'OPEN_SHORT', 'SHORT_TRAILING'] }, mode: m },
      select: { avgEntryPrice: true, quantity: true },
    });

    return openPositions.reduce((sum, p) => {
      return sum + Number(p.avgEntryPrice) * Number(p.quantity);
    }, 0);
  }

  updateDailyPnl(pnl: number) {
    this.dailyPnl += pnl;
  }

  async triggerEmergencyStop() {
    this.emergencyStop = true;
    await this.logRiskEvent('EMERGENCY_STOP', 'Emergency stop triggered', 'CRITICAL');
  }

  async resetEmergencyStop() {
    this.emergencyStop = false;
  }

  isEmergencyStop() {
    return this.emergencyStop;
  }

  getDailyPnl() {
    return this.dailyPnl;
  }

  async getStats() {
    const mode = this.botConfig.getMode();
    const openPositions = await this.prisma.position.count({
      where: { status: { in: ['OPEN_LONG', 'LONG_TRAILING', 'OPEN_SHORT', 'SHORT_TRAILING'] }, mode },
    });
    const riskEvents = await this.prisma.riskEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 20 });
    const cooldowns = await this.prisma.cooldownEvent.findMany({
      where: { mode, active: true, endsAt: { gt: new Date() } },
    });
    return {
      mode,
      emergencyStop: this.emergencyStop,
      dailyPnl: this.dailyPnl,
      openPositions,
      exposure: await this.getCurrentExposure(mode),
      riskEvents,
      cooldowns,
    };
  }

  private async logRiskEvent(type: string, description: string, severity: string) {
    try {
      await this.prisma.riskEvent.create({ data: { type, description, severity } });
    } catch (err) {
      this.logger.error('Failed to log risk event: ' + err.message);
    }
  }
}
