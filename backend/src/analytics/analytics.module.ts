import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { BotConfigModule } from '../config/bot-config.module';

@Module({
  imports: [BotConfigModule],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
