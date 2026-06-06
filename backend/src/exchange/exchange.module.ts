import { Module } from '@nestjs/common';
import { ExchangeService } from './exchange.service';
import { BotConfigModule } from '../config/bot-config.module';

@Module({
  imports: [BotConfigModule],
  providers: [ExchangeService],
  exports: [ExchangeService],
})
export class ExchangeModule {}
