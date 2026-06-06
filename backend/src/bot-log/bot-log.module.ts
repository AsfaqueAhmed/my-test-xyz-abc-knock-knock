import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BotLogService } from './bot-log.service';
import { BotConfigModule } from '../config/bot-config.module';

@Module({
  imports: [PrismaModule, BotConfigModule],
  providers: [BotLogService],
  exports: [BotLogService],
})
export class BotLogModule {}
