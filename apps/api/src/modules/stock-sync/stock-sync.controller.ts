import { Controller, Get, Post, Body, Param } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { StockSyncService } from './stock-sync.service'
import { ApplySyncDto } from './dto/stock-sync.dto'
import { TenantId } from '../../common/decorators/tenant-id.decorator'

@ApiTags('Stock Sync')
@ApiBearerAuth()
@Controller('stock-sync')
export class StockSyncController {
  constructor(private stockSyncService: StockSyncService) {}

  @Get('recommendations/:connectionId')
  @ApiOperation({ summary: 'Recomendaciones de sincronización para una conexión' })
  getRecommendations(@TenantId() tenantId: string, @Param('connectionId') connectionId: string) {
    return this.stockSyncService.getRecommendations(tenantId, connectionId)
  }

  @Post('apply/:connectionId')
  @ApiOperation({ summary: 'Aplicar sincronización de stock maestro → marketplace' })
  applySync(
    @TenantId() tenantId: string,
    @Param('connectionId') connectionId: string,
    @Body() dto: ApplySyncDto,
  ) {
    return this.stockSyncService.applySync(tenantId, connectionId, dto.productId, dto.marketplaceProductId, dto.marketplaceSku)
  }

  @Post('sync-all/:connectionId')
  @ApiOperation({ summary: 'Sincronizar stock de todos los productos vinculados de una conexión' })
  manualSyncAll(@TenantId() tenantId: string, @Param('connectionId') connectionId: string) {
    return this.stockSyncService.manualSyncAll(tenantId, connectionId)
  }
}
