import { Module, forwardRef } from '@nestjs/common'
import { CatalogSourceService } from './catalog-source.service'
import { CatalogSourceController } from './catalog-source.controller'
import { InventoryModule } from '../inventory/inventory.module'
import { SyncModule } from '../sync/sync.module'

@Module({
  imports: [forwardRef(() => InventoryModule), forwardRef(() => SyncModule)],
  controllers: [CatalogSourceController],
  providers: [CatalogSourceService],
  exports: [CatalogSourceService],
})
export class CatalogSourceModule {}
