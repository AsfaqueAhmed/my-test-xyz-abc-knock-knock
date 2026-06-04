import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaModule } from './prisma/prisma.module';
import { MarketDataModule } from './market-data/market-data.module';
import { IndicatorsModule } from './indicators/indicators.module';
import { SignalEngineModule } from './signal-engine/signal-engine.module';
import { PositionEngineModule } from './position-engine/position-engine.module';
import { RiskEngineModule } from './risk-engine/risk-engine.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { BotConfigModule } from './config/bot-config.module';
import { AppController } from './app.controller';
import { PositionEngineService } from './position-engine/position-engine.service';
import { SignalEngineService } from './signal-engine/signal-engine.service';
import { AnalyticsService } from './analytics/analytics.service';
import { RiskEngineService } from './risk-engine/risk-engine.service';
import { BotConfigService } from './config/bot-config.service';
import { MarketDataService } from './market-data/market-data.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    PrismaModule,
    MarketDataModule,
    IndicatorsModule,
    SignalEngineModule,
    RiskEngineModule,
    BotConfigModule,
    PositionEngineModule,
    AnalyticsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
