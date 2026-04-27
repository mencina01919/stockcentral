import { Controller, Get, Patch, Post, Body, Param, Query } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { InventoryService } from './inventory.service'
import { UpdateInventoryDto, StockMovementDto, InventoryQueryDto } from './dto/inventory.dto'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'

@ApiTags('Inventory')
@ApiBearerAuth()
@Controller('inventory')
export class InventoryController {
  constructor(private inventoryService: InventoryService) {}

  @Get()
  @ApiOperation({ summary: 'Listar inventario' })
  findAll(@TenantId() tenantId: string, @Query() query: InventoryQueryDto) {
    return this.inventoryService.findAll(tenantId, query)
  }

  @Get('alerts')
  @ApiOperation({ summary: 'Alertas de bajo stock' })
  getLowStockAlerts(@TenantId() tenantId: string) {
    return this.inventoryService.getLowStockAlerts(tenantId)
  }

  @Get('product/:productId')
  @ApiOperation({ summary: 'Inventario por producto' })
  findByProduct(@TenantId() tenantId: string, @Param('productId') productId: string) {
    return this.inventoryService.findByProduct(tenantId, productId)
  }

  @Get(':id/movements')
  @ApiOperation({ summary: 'Movimientos de inventario' })
  getMovements(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.inventoryService.getMovements(tenantId, id)
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar stock' })
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateInventoryDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.inventoryService.update(tenantId, id, dto, userId)
  }

  @Post('movements')
  @ApiOperation({ summary: 'Registrar movimiento de stock' })
  createMovement(
    @TenantId() tenantId: string,
    @Body() dto: StockMovementDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.inventoryService.createMovement(tenantId, dto, userId)
  }
}
