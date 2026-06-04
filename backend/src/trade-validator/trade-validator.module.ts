import { Module } from '@nestjs/common';
import { TradeValidatorService } from './trade-validator.service';
import { BotConfigModule } from '../config/bot-config.module';
@Module({
  imports: [BotConfigModule],
  providers: [TradeValidatorService],
  exports: [TradeValidatorService],
})
export class TradeValidatorModule {}
