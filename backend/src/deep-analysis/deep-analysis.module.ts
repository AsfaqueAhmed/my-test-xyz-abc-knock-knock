import { Module } from '@nestjs/common';
import { DeepAnalysisService } from './deep-analysis.service';
import { BotConfigModule } from '../config/bot-config.module';
import { MarketScannerModule } from '../market-scanner/market-scanner.module';
@Module({
  imports: [BotConfigModule, MarketScannerModule],
  providers: [DeepAnalysisService],
  exports: [DeepAnalysisService],
})
export class DeepAnalysisModule {}
