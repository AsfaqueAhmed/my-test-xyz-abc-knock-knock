import { Module } from '@nestjs/common';
import { BotConfigService } from './bot-config.service';

@Module({
  providers: [BotConfigService],
  exports: [BotConfigService],
})
export class BotConfigModule {}
