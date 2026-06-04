import { Module } from '@nestjs/common';
import { PositionEngineService } from './position-engine.service';
import { MarketDataModule } from '../market-data/market-data.module';
import { RiskEngineModule } from '../risk-engine/risk-engine.module';
import { BotConfigModule } from '../config/bot-config.module';

@Module({
  imports: [MarketDataModule, RiskEngineModule, BotConfigModule],
  providers: [PositionEngineService],
  exports: [PositionEngineService],
})
export class PositionEngineModule {}
