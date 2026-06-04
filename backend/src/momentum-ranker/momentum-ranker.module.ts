import { Module } from '@nestjs/common';
import { MomentumRankerService } from './momentum-ranker.service';
import { MarketScannerModule } from '../market-scanner/market-scanner.module';
import { BotConfigModule } from '../config/bot-config.module';
@Module({
  imports: [MarketScannerModule, BotConfigModule],
  providers: [MomentumRankerService],
  exports: [MomentumRankerService],
})
export class MomentumRankerModule {}
