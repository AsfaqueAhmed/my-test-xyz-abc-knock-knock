import { Module } from '@nestjs/common';
import { SignalEngineService } from './signal-engine.service';
import { MarketDataModule } from '../market-data/market-data.module';
import { IndicatorsModule } from '../indicators/indicators.module';
import { BotConfigModule } from '../config/bot-config.module';

@Module({
  imports: [MarketDataModule, IndicatorsModule, BotConfigModule],
  providers: [SignalEngineService],
  exports: [SignalEngineService],
})
export class SignalEngineModule {}
