import { Body, Controller, Get, Post, Param, Query, UseGuards } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { SyncService } from './sync.service'

@ApiTags('Sync')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('connections/:id')
  @ApiOperation({ summary: 'Disparar sincronización completa (órdenes + productos)' })
  triggerSync(@TenantId() tenantId: string, @Param('id') connectionId: string) {
    return this.syncService.triggerFullSync(tenantId, connectionId)
  }

  @Post('connections/:id/products')
  @ApiOperation({ summary: 'Sincronizar productos hacia el marketplace' })
  syncProducts(@TenantId() tenantId: string, @Param('id') connectionId: string) {
    return this.syncService.enqueueProductsOutbound(tenantId, connectionId)
  }

  @Post('connections/:id/orders')
  @ApiOperation({ summary: 'Importar órdenes desde el marketplace' })
  syncOrders(
    @TenantId() tenantId: string,
    @Param('id') connectionId: string,
    @Query('since') since?: string,
    @Query('days') days?: string,
  ) {
    let sinceDate: Date | undefined
    if (since) sinceDate = new Date(since)
    else if (days) sinceDate = new Date(Date.now() - parseInt(days, 10) * 86400000)
    return this.syncService.enqueueOrdersInbound(tenantId, connectionId, sinceDate)
  }

  @Post('connections/:id/test')
  @ApiOperation({ summary: 'Probar conexión con el marketplace' })
  testConnection(@TenantId() tenantId: string, @Param('id') connectionId: string) {
    return this.syncService.testConnection(tenantId, connectionId)
  }

  @Get('queue/stats')
  @ApiOperation({ summary: 'Estadísticas de la cola de sincronización' })
  getQueueStats() {
    return this.syncService.getQueueStats()
  }

  @Get('audit/mappings')
  @ApiOperation({ summary: 'Auditar mappings sospechosos sin modificar nada' })
  auditMappings(@TenantId() tenantId: string) {
    return this.syncService.auditMappings(tenantId)
  }

  @Post('audit/cleanup')
  @ApiOperation({ summary: 'Borrar mappings sospechosos detectados por la auditoría' })
  cleanupBogusMappings(@TenantId() tenantId: string) {
    return this.syncService.cleanupBogusMappings(tenantId)
  }

  // Diagnóstico: ejecuta updateProduct + updateStock para un producto puntual
  // y devuelve la respuesta cruda del marketplace. No actualiza mappings ni
  // crea logs — sirve solo para inspeccionar el shape XML y la respuesta de
  // la API externa cuando el sync "dice success" pero el precio no cambia.
  @Post('connections/:id/diag-push/:productId')
  @ApiOperation({ summary: 'Diagnóstico: push de un producto y devuelve respuesta cruda' })
  diagPushProduct(
    @TenantId() tenantId: string,
    @Param('id') connectionId: string,
    @Param('productId') productId: string,
    @Body() overrides?: { price?: number; salePrice?: number; saleStartDate?: string; saleEndDate?: string },
  ) {
    return this.syncService.diagPushSingle(tenantId, connectionId, productId, overrides)
  }

  @Get('connections/:id/diag-read/:productId')
  @ApiOperation({ summary: 'Diagnóstico: lee precio/stock actual del marketplace' })
  diagReadProduct(
    @TenantId() tenantId: string,
    @Param('id') connectionId: string,
    @Param('productId') productId: string,
  ) {
    return this.syncService.diagReadCurrent(tenantId, connectionId, productId)
  }

  // Diagnóstico Lider: estado real de feeds Walmart.
  @Get('connections/:id/lider-feed/:feedId')
  @ApiOperation({ summary: 'Lider: consultar estado de un feed específico' })
  liderFeed(
    @TenantId() tenantId: string,
    @Param('id') connectionId: string,
    @Param('feedId') feedId: string,
  ) {
    return this.syncService.liderFeedStatus(tenantId, connectionId, feedId)
  }

  @Get('connections/:id/lider-feeds')
  @ApiOperation({ summary: 'Lider: listar últimos feeds enviados a Walmart' })
  liderFeeds(
    @TenantId() tenantId: string,
    @Param('id') connectionId: string,
  ) {
    return this.syncService.liderFeedsList(tenantId, connectionId)
  }

  @Get('connections/:id/lider-stock/:sku')
  @ApiOperation({ summary: 'Lider: consultar stock actual de un SKU' })
  liderStock(
    @TenantId() tenantId: string,
    @Param('id') connectionId: string,
    @Param('sku') sku: string,
  ) {
    return this.syncService.liderGetStock(tenantId, connectionId, sku)
  }

  @Post('connections/:id/lider-price/:sku')
  @ApiOperation({ summary: 'Lider: actualizar precio vía PUT /v3/price (no feed)' })
  liderPushPrice(
    @TenantId() tenantId: string,
    @Param('id') connectionId: string,
    @Param('sku') sku: string,
    @Body() body: { price: number },
  ) {
    return this.syncService.liderPushPrice(tenantId, connectionId, sku, body.price)
  }

  @Post('connections/:id/lider-stock-push/:sku')
  @ApiOperation({ summary: 'Lider: actualizar stock vía PUT /v3/inventory con cantidad arbitraria' })
  liderPushStock(
    @TenantId() tenantId: string,
    @Param('id') connectionId: string,
    @Param('sku') sku: string,
    @Body() body: { stock: number },
  ) {
    return this.syncService.liderPushStockManual(tenantId, connectionId, sku, body.stock)
  }
}
