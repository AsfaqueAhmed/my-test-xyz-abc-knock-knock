import { Module } from '@nestjs/common';
import { PositionEngineService } from './position-engine.service';
import { MarketScannerModule } from '../market-scanner/market-scanner.module';
import { RiskEngineModule } from '../risk-engine/risk-engine.module';
import { BotConfigModule } from '../config/bot-config.module';
import { DeepAnalysisModule } from '../deep-analysis/deep-analysis.module';
import { BalanceModule } from '../balance/balance.module';

@Module({
  imports: [MarketScannerModule, RiskEngineModule, BotConfigModule, DeepAnalysisModule, BalanceModule],
  providers: [PositionEngineService],
  exports: [PositionEngineService],
})
export class PositionEngineModule {}
