import { Module } from '@nestjs/common'
import { StockSyncController } from './stock-sync.controller'
import { StockSyncService } from './stock-sync.service'

@Module({
  controllers: [StockSyncController],
  providers: [StockSyncService],
  exports: [StockSyncService],
})
export class StockSyncModule {}
