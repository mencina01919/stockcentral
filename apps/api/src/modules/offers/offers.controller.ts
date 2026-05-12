import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { TenantId } from '../../common/decorators/tenant-id.decorator'
import { OffersService } from './offers.service'
import { CreateOfferDto, UpdateOfferDto, ListOffersQueryDto } from './dto/offer.dto'

@ApiTags('Offers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('offers')
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  @Get()
  @ApiOperation({ summary: 'Listar ofertas del tenant con filtros' })
  list(@TenantId() tenantId: string, @Query() query: ListOffersQueryDto) {
    return this.offers.list(tenantId, query)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de una oferta' })
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.offers.findOne(tenantId, id)
  }

  @Post()
  @ApiOperation({ summary: 'Crear nueva oferta (queda scheduled)' })
  create(@TenantId() tenantId: string, @Body() dto: CreateOfferDto) {
    return this.offers.create(tenantId, dto)
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Editar oferta scheduled o active' })
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateOfferDto) {
    return this.offers.update(tenantId, id, dto)
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Cancelar oferta (limpia en marketplace si está activa)' })
  cancel(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.offers.cancel(tenantId, id)
  }

  // ─── Acciones manuales (bypass scheduler) ─────────────────────────────────

  @Post(':id/activate-now')
  @ApiOperation({ summary: 'Forzar activación + push inmediato al marketplace' })
  async activateNow(@TenantId() tenantId: string, @Param('id') id: string) {
    await this.offers.findOne(tenantId, id) // valida tenant
    await this.offers.activateAndPush(id)
    return { ok: true, id }
  }

  @Post(':id/expire-now')
  @ApiOperation({ summary: 'Forzar expiración + limpieza inmediata' })
  async expireNow(@TenantId() tenantId: string, @Param('id') id: string) {
    await this.offers.findOne(tenantId, id)
    await this.offers.expireAndClear(id)
    return { ok: true, id }
  }

  @Post(':id/resync')
  @ApiOperation({ summary: 'Re-sincronizar oferta activa (drift fix)' })
  async resync(@TenantId() tenantId: string, @Param('id') id: string) {
    await this.offers.findOne(tenantId, id)
    await this.offers.resyncActive(id)
    return { ok: true, id }
  }

  // ─── Detección de ofertas externas ────────────────────────────────────────

  @Post('scan-external/:connectionId')
  @ApiOperation({ summary: 'Escanear marketplace y crear ofertas detected_external para las que no estén trackeadas' })
  scanExternal(@TenantId() tenantId: string, @Param('connectionId') connectionId: string) {
    return this.offers.scanExternalOffers(tenantId, connectionId)
  }
}
