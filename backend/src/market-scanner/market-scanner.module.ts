import { Module } from '@nestjs/common';
import { MarketScannerService } from './market-scanner.service';
import { BotConfigModule } from '../config/bot-config.module';
@Module({
  imports: [BotConfigModule],
  providers: [MarketScannerService],
  exports: [MarketScannerService],
})
export class MarketScannerModule {}
