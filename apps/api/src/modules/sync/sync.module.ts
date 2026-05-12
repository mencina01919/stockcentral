import { Module, forwardRef } from '@nestjs/common'
import { BullModule } from '@nestjs/bull'
import { SyncService } from './sync.service'
import { SyncController } from './sync.controller'
import { SyncProcessor } from './sync.processor'
import { SYNC_QUEUE } from './sync.constants'
import { BillingModule } from '../billing/billing.module'
import { InventoryModule } from '../inventory/inventory.module'

@Module({
  imports: [
    BullModule.registerQueue({
      name: SYNC_QUEUE,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    }),
    BillingModule,
    forwardRef(() => InventoryModule),
  ],
  controllers: [SyncController],
  providers: [SyncService, SyncProcessor],
  exports: [SyncService],
})
export class SyncModule {}
