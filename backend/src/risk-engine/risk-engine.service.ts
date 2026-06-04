import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BotConfigService } from '../config/bot-config.service';

export interface RiskCheck {
  allowed: boolean;
  reason?: string;
}

export interface RiskCheckOptions {
  ignorePositionLimit?: boolean;
}

@Injectable()
export class RiskEngineService {
  private readonly logger = new Logger(RiskEngineService.name);
  private dailyPnl = 0;
  private emergencyStop = false;
  private lastDailyReset = new Date().toDateString();

  constructor(
    private readonly prisma: PrismaService,
    private readonly botConfig: BotConfigService,
  ) {}

  async checkDailyReset() {
    const today = new Date().toDateString();
    if (today !== this.lastDailyReset) {
      this.dailyPnl = 0;
      this.lastDailyReset = today;
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
      const drawdownPct = Math.abs(this.dailyPnl) / config.initialBalance * 100;
      if (drawdownPct >= config.maxDailyDrawdownPct) {
        await this.logRiskEvent('DAILY_DRAWDOWN', `Daily drawdown ${drawdownPct.toFixed(2)}% exceeds limit`, 'HIGH');
        return { allowed: false, reason: `Daily drawdown limit reached (${drawdownPct.toFixed(2)}%)` };
      }
    }

    // Check open positions count
    const openPositions = await this.prisma.position.count({
      where: { status: { in: ['OPEN_LONG', 'LONG_TRAILING', 'OPEN_SHORT', 'SHORT_TRAILING'] } },
    });

    if (!options.ignorePositionLimit && openPositions >= config.maxActivePositions) {
      return { allowed: false, reason: `Max active positions reached (${openPositions}/${config.maxActivePositions})` };
    }

    const exposure = await this.getCurrentExposure();
    const maxExposure = config.initialBalance * (config.maxExposurePct / 100);
    if (exposure + capital > maxExposure) {
      return {
        allowed: false,
        reason: `Max exposure exceeded ($${(exposure + capital).toFixed(2)}/$${maxExposure.toFixed(2)})`,
      };
    }

    // Check per-symbol entries
    const symbolPositions = await this.prisma.position.count({
      where: {
        symbol,
        status: { in: ['OPEN_LONG', 'LONG_TRAILING', 'OPEN_SHORT', 'SHORT_TRAILING'] },
      },
    });

    if (symbolPositions >= config.maxEntriesPerSymbol) {
      return { allowed: false, reason: `Max entries for ${symbol} reached` };
    }

    return { allowed: true };
  }

  async checkCooldown(symbol: string): Promise<RiskCheck> {
    const now = new Date();
    const activeCooldown = await this.prisma.cooldownEvent.findFirst({
      where: {
        symbol,
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
    const windowMs = config.cooldownWindowMin * 60 * 1000;
    const since = new Date(Date.now() - windowMs);

    // Count recent entries for this symbol
    const recentEntries = await this.prisma.position.count({
      where: {
        symbol,
        openedAt: { gte: since },
      },
    });

    if (recentEntries >= config.cooldownEntries) {
      const endsAt = new Date(Date.now() + config.cooldownDurationMin * 60 * 1000);
      await this.prisma.cooldownEvent.create({
        data: {
          symbol,
          reason: `${recentEntries} entries in ${config.cooldownWindowMin} minutes`,
          startsAt: new Date(),
          endsAt,
          active: true,
        },
      });
      this.logger.warn(`Cooldown activated for ${symbol}`);
    }
  }

  private async getCurrentExposure(): Promise<number> {
    const openPositions = await this.prisma.position.findMany({
      where: { status: { in: ['OPEN_LONG', 'LONG_TRAILING', 'OPEN_SHORT', 'SHORT_TRAILING'] } },
      select: { avgEntryPrice: true, quantity: true, leverage: true },
    });

    return openPositions.reduce((sum, p) => {
      const leverage = p.leverage || 1;
      return sum + (Number(p.avgEntryPrice) * Number(p.quantity)) / leverage;
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
    const openPositions = await this.prisma.position.count({
      where: { status: { in: ['OPEN_LONG', 'LONG_TRAILING', 'OPEN_SHORT', 'SHORT_TRAILING'] } },
    });
    const riskEvents = await this.prisma.riskEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const cooldowns = await this.prisma.cooldownEvent.findMany({
      where: { active: true, endsAt: { gt: new Date() } },
    });
    return {
      emergencyStop: this.emergencyStop,
      dailyPnl: this.dailyPnl,
      openPositions,
      exposure: await this.getCurrentExposure(),
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
