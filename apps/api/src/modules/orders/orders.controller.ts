import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { OrdersService } from './orders.service'
import {
  CreateOrderDto,
  UpdateOrderStatusDto,
  UpdateOrderInternalStatusDto,
  OrderQueryDto,
} from './dto/order.dto'
import { TenantId } from '../../common/decorators/tenant-id.decorator'

@ApiTags('Orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private ordersService: OrdersService) {}

  @Get()
  @ApiOperation({ summary: 'Listar órdenes' })
  findAll(@TenantId() tenantId: string, @Query() query: OrderQueryDto) {
    return this.ordersService.findAll(tenantId, query)
  }

  @Get('stats')
  @ApiOperation({ summary: 'Estadísticas de órdenes' })
  getStats(@TenantId() tenantId: string) {
    return this.ordersService.getStats(tenantId)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener orden por ID' })
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.ordersService.findOne(tenantId, id)
  }

  @Post()
  @ApiOperation({ summary: 'Crear orden' })
  create(@TenantId() tenantId: string, @Body() dto: CreateOrderDto) {
    return this.ordersService.create(tenantId, dto)
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Cambiar estado de orden' })
  updateStatus(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(tenantId, id, dto)
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancelar orden' })
  cancel(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.ordersService.cancel(tenantId, id)
  }

  @Patch(':id/advance')
  @ApiOperation({ summary: 'Avanzar orden al siguiente estado' })
  advance(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.ordersService.advance(tenantId, id)
  }

  @Patch(':id/internal-status')
  @ApiOperation({ summary: 'Cambiar estado interno (flujo de fulfillment, no toca el marketplace)' })
  updateInternalStatus(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateOrderInternalStatusDto,
  ) {
    return this.ordersService.updateInternalStatus(tenantId, id, dto)
  }

  @Patch(':id/internal-advance')
  @ApiOperation({ summary: 'Avanzar el estado interno al siguiente paso' })
  advanceInternal(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.ordersService.advanceInternal(tenantId, id)
  }

  @Post(':id/refresh')
  @ApiOperation({
    summary:
      'Refrescar estado desde el marketplace (mediación, no entrega, etc.). Usa GET /orders/{id} del driver.',
  })
  refresh(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.ordersService.refreshFromMarketplace(tenantId, id)
  }
}
