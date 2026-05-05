import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { WarehousesService } from './warehouses.service'
import {
  CreateWarehouseDto,
  UpdateWarehouseDto,
  StockTransferDto,
  WarehouseQueryDto,
} from './dto/warehouse.dto'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'

@ApiTags('Warehouses')
@ApiBearerAuth()
@Controller('warehouses')
export class WarehousesController {
  constructor(private warehousesService: WarehousesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar bodegas' })
  findAll(@TenantId() tenantId: string, @Query() query: WarehouseQueryDto) {
    return this.warehousesService.findAll(tenantId, query)
  }

  @Get('transfers')
  @ApiOperation({ summary: 'Historial de transferencias' })
  getTransfers(@TenantId() tenantId: string, @Query('warehouseId') warehouseId?: string) {
    return this.warehousesService.getTransfers(tenantId, warehouseId)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de bodega con inventario' })
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.warehousesService.findOne(tenantId, id)
  }

  @Post()
  @ApiOperation({ summary: 'Crear bodega' })
  create(@TenantId() tenantId: string, @Body() dto: CreateWarehouseDto) {
    return this.warehousesService.create(tenantId, dto)
  }

  @Post('transfer')
  @ApiOperation({ summary: 'Transferir stock entre bodegas' })
  transfer(
    @TenantId() tenantId: string,
    @Body() dto: StockTransferDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.warehousesService.transfer(tenantId, dto, userId)
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar bodega' })
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateWarehouseDto,
  ) {
    return this.warehousesService.update(tenantId, id, dto)
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Desactivar bodega' })
  deactivate(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.warehousesService.deactivate(tenantId, id)
  }
}
