import { Module, forwardRef } from '@nestjs/common'
import { WarehousesController } from './warehouses.controller'
import { WarehousesService } from './warehouses.service'
import { InventoryModule } from '../inventory/inventory.module'

@Module({
  imports: [forwardRef(() => InventoryModule)],
  controllers: [WarehousesController],
  providers: [WarehousesService],
  exports: [WarehousesService],
})
export class WarehousesModule {}
