import { Controller, Get, Post, Param, Query, UseGuards } from '@nestjs/common'
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
  ) {
    return this.syncService.diagPushSingle(tenantId, connectionId, productId)
  }
}
