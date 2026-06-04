import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BotLogService } from './bot-log.service';

@Module({
  imports: [PrismaModule],
  providers: [BotLogService],
  exports: [BotLogService],
})
export class BotLogModule {}
