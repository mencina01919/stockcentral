import { Controller, Get, Post, Delete, Patch, Body, Param, Query } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { CatalogSourceService } from './catalog-source.service'
import { TenantId } from '../../common/decorators/tenant-id.decorator'

@ApiTags('Catalog Source')
@ApiBearerAuth()
@Controller('catalog-source')
export class CatalogSourceController {
  constructor(private service: CatalogSourceService) {}

  @Get('candidates')
  @ApiOperation({ summary: 'Conexiones que pueden ser fuente del catálogo + cuál está activa' })
  candidates(@TenantId() tenantId: string) {
    return this.service.listCandidates(tenantId)
  }

  @Get('active')
  @ApiOperation({ summary: 'Conexión actualmente marcada como fuente del catálogo (o null)' })
  active(@TenantId() tenantId: string) {
    return this.service.getActive(tenantId)
  }

  @Post(':connectionId/activate')
  @ApiOperation({ summary: 'Marcar una conexión como fuente del catálogo (desactiva la anterior)' })
  activate(
    @TenantId() tenantId: string,
    @Param('connectionId') connectionId: string,
    @Body() body?: { catalogConfig?: Record<string, unknown> },
  ) {
    return this.service.setSource(tenantId, connectionId, body?.catalogConfig)
  }

  @Delete('active')
  @ApiOperation({ summary: 'Desmarcar la fuente actual (queda sin fuente)' })
  deactivate(@TenantId() tenantId: string) {
    return this.service.clearSource(tenantId)
  }

  @Patch('config')
  @ApiOperation({ summary: 'Actualizar opciones de sincronización (autoSyncStock, autoSyncProducts, ...)' })
  updateConfig(@TenantId() tenantId: string, @Body() body: Record<string, unknown>) {
    return this.service.updateConfig(tenantId, body)
  }

  @Post('import')
  @ApiOperation({ summary: 'Ejecutar import/sync ahora desde la fuente activa' })
  runImport(
    @TenantId() tenantId: string,
    @Query('syncProducts') syncProducts?: string,
    @Query('syncStock') syncStock?: string,
  ) {
    return this.service.runImport(tenantId, {
      syncProducts: syncProducts === undefined ? undefined : syncProducts === 'true',
      syncStock: syncStock === undefined ? undefined : syncStock === 'true',
    })
  }

  @Post('sync-stock')
  @ApiOperation({ summary: 'Sincronizar solo el stock desde la fuente (más liviano que import)' })
  syncStock(@TenantId() tenantId: string) {
    return this.service.runStockSync(tenantId)
  }
}
