import { Module, forwardRef } from '@nestjs/common'
import { ProductsController } from './products.controller'
import { ProductsService } from './products.service'
import { MarketplaceCacheService } from './marketplace-cache.service'
import { SyncModule } from '../sync/sync.module'
import { InventoryModule } from '../inventory/inventory.module'

@Module({
  imports: [SyncModule, forwardRef(() => InventoryModule)],
  controllers: [ProductsController],
  providers: [ProductsService, MarketplaceCacheService],
  exports: [ProductsService, MarketplaceCacheService],
})
export class ProductsModule {}
