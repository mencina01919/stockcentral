import { Controller, Get, Param, Query } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { SalesService } from './sales.service'
import { SaleQueryDto } from './dto/sale.dto'
import { TenantId } from '../../common/decorators/tenant-id.decorator'

@ApiTags('Sales')
@ApiBearerAuth()
@Controller('sales')
export class SalesController {
  constructor(private salesService: SalesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar ventas (agrupadas por pack)' })
  findAll(@TenantId() tenantId: string, @Query() query: SaleQueryDto) {
    return this.salesService.findAll(tenantId, query)
  }

  @Get('stats')
  @ApiOperation({ summary: 'Estadísticas de ventas' })
  getStats(@TenantId() tenantId: string) {
    return this.salesService.getStats(tenantId)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de venta con sus órdenes' })
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.salesService.findOne(tenantId, id)
  }
}
