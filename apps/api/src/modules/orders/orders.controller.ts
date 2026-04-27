import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { OrdersService } from './orders.service'
import { CreateOrderDto, UpdateOrderStatusDto, OrderQueryDto } from './dto/order.dto'
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
}
