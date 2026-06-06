import { Module } from '@nestjs/common';
import { RiskEngineService } from './risk-engine.service';
import { BotConfigModule } from '../config/bot-config.module';
import { BalanceModule } from '../balance/balance.module';

@Module({
  imports: [BotConfigModule, BalanceModule],
  providers: [RiskEngineService],
  exports: [RiskEngineService],
})
export class RiskEngineModule {}
