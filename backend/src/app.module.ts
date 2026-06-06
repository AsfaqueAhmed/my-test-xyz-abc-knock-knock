import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaModule } from './prisma/prisma.module';
import { BotConfigModule } from './config/bot-config.module';
import { MarketScannerModule } from './market-scanner/market-scanner.module';
import { MomentumRankerModule } from './momentum-ranker/momentum-ranker.module';
import { DeepAnalysisModule } from './deep-analysis/deep-analysis.module';
import { TradeValidatorModule } from './trade-validator/trade-validator.module';
import { PortfolioManagerModule } from './portfolio-manager/portfolio-manager.module';
import { PositionEngineModule } from './position-engine/position-engine.module';
import { RiskEngineModule } from './risk-engine/risk-engine.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { BotLogModule } from './bot-log/bot-log.module';
import { BalanceModule } from './balance/balance.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    PrismaModule,
    BotConfigModule,
    MarketScannerModule,
    MomentumRankerModule,
    DeepAnalysisModule,
    TradeValidatorModule,
    RiskEngineModule,
    PortfolioManagerModule,
    PositionEngineModule,
    AnalyticsModule,
    BotLogModule,
    BalanceModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
