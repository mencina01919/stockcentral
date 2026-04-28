import { Module, forwardRef } from '@nestjs/common'
import { InventoryController } from './inventory.controller'
import { InventoryService } from './inventory.service'
import { SyncModule } from '../sync/sync.module'

@Module({
  imports: [forwardRef(() => SyncModule)],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
