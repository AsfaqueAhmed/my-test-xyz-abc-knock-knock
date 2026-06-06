import { Module } from '@nestjs/common';
import { PositionEngineService } from './position-engine.service';
import { MarketScannerModule } from '../market-scanner/market-scanner.module';
import { RiskEngineModule } from '../risk-engine/risk-engine.module';
import { BotConfigModule } from '../config/bot-config.module';
import { DeepAnalysisModule } from '../deep-analysis/deep-analysis.module';
import { BalanceModule } from '../balance/balance.module';
import { BotLogModule } from '../bot-log/bot-log.module';
import { ExchangeModule } from '../exchange/exchange.module';

@Module({
  imports: [MarketScannerModule, RiskEngineModule, BotConfigModule, DeepAnalysisModule, BalanceModule, BotLogModule, ExchangeModule],
  providers: [PositionEngineService],
  exports: [PositionEngineService],
})
export class PositionEngineModule {}
