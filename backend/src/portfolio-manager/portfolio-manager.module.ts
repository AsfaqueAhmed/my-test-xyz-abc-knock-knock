import { Module } from '@nestjs/common';
import { PortfolioManagerService } from './portfolio-manager.service';
import { MarketScannerModule } from '../market-scanner/market-scanner.module';
import { MomentumRankerModule } from '../momentum-ranker/momentum-ranker.module';
import { DeepAnalysisModule } from '../deep-analysis/deep-analysis.module';
import { TradeValidatorModule } from '../trade-validator/trade-validator.module';
import { BotConfigModule } from '../config/bot-config.module';
import { RiskEngineModule } from '../risk-engine/risk-engine.module';
import { PositionEngineModule } from '../position-engine/position-engine.module';
import { BotLogModule } from '../bot-log/bot-log.module';
@Module({
  imports: [MarketScannerModule, MomentumRankerModule, DeepAnalysisModule, TradeValidatorModule, BotConfigModule, RiskEngineModule, PositionEngineModule, BotLogModule],
  providers: [PortfolioManagerService],
  exports: [PortfolioManagerService],
})
export class PortfolioManagerModule {}
