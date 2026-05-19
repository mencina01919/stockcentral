import { Module, forwardRef } from '@nestjs/common'
import { CatalogSourceService } from './catalog-source.service'
import { CatalogSourceController } from './catalog-source.controller'
import { InventoryModule } from '../inventory/inventory.module'

@Module({
  imports: [forwardRef(() => InventoryModule)],
  controllers: [CatalogSourceController],
  providers: [CatalogSourceService],
  exports: [CatalogSourceService],
})
export class CatalogSourceModule {}
