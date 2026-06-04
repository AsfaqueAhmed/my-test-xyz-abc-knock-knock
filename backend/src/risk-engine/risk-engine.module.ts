import { Module } from '@nestjs/common';
import { RiskEngineService } from './risk-engine.service';
import { BotConfigModule } from '../config/bot-config.module';

@Module({
  imports: [BotConfigModule],
  providers: [RiskEngineService],
  exports: [RiskEngineService],
})
export class RiskEngineModule {}
