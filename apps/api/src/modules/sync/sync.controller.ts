import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common'
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
  syncOrders(@TenantId() tenantId: string, @Param('id') connectionId: string) {
    return this.syncService.enqueueOrdersInbound(tenantId, connectionId)
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
}
