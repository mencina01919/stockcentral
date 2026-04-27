import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Redirect, UseGuards } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { ConnectionsService } from './connections.service'
import { CreateConnectionDto, UpdateConnectionDto, OAuthInitDto } from './dto/connection.dto'
import { TenantId } from '../../common/decorators/tenant-id.decorator'

@ApiTags('Connections')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('connections')
export class ConnectionsController {
  constructor(private connectionsService: ConnectionsService) {}

  @Get('providers')
  @ApiOperation({ summary: 'Listar proveedores soportados' })
  getProviders() {
    return this.connectionsService.getProviders()
  }

  @Get()
  @ApiOperation({ summary: 'Listar conexiones del tenant' })
  findAll(@TenantId() tenantId: string) {
    return this.connectionsService.findAll(tenantId)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener conexión por ID' })
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.connectionsService.findOne(tenantId, id)
  }

  @Get(':id/status')
  @ApiOperation({ summary: 'Estado de sincronización y mappings' })
  getStatus(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.connectionsService.getStatus(tenantId, id)
  }

  @Post()
  @ApiOperation({ summary: 'Conectar nueva plataforma con credenciales (API Key/Basic)' })
  create(@TenantId() tenantId: string, @Body() dto: CreateConnectionDto) {
    return this.connectionsService.create(tenantId, dto)
  }

  @Post('oauth/:provider/init')
  @ApiOperation({ summary: 'Obtener URL de autorización OAuth (ML, Shopify, Jumpseller)' })
  getOAuthUrl(
    @Param('provider') provider: string,
    @Body() dto: OAuthInitDto,
  ) {
    return this.connectionsService.getAuthUrl(provider, dto as unknown as Record<string, string>)
  }

  @Get('oauth/:provider/callback')
  @ApiOperation({ summary: 'Callback OAuth — intercambia código por token' })
  @ApiQuery({ name: 'code', required: true })
  @ApiQuery({ name: 'state', required: false })
  @ApiQuery({ name: 'tenant_id', required: true })
  async oauthCallback(
    @Param('provider') provider: string,
    @Query('code') code: string,
    @Query('tenant_id') tenantId: string,
    @Query('state') state?: string,
  ) {
    const connection = await this.connectionsService.handleOAuthCallback(provider, code, tenantId, {})
    return { success: true, connection: { id: connection.id, name: connection.name, provider: connection.provider, status: connection.status } }
  }

  @Post(':id/sync')
  @ApiOperation({ summary: 'Disparar sincronización completa' })
  triggerSync(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.connectionsService.triggerSync(tenantId, id)
  }

  @Post(':id/test')
  @ApiOperation({ summary: 'Probar credenciales de la conexión' })
  testConnection(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.connectionsService.testConnection(tenantId, id)
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar conexión' })
  update(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateConnectionDto,
  ) {
    return this.connectionsService.update(tenantId, id, dto)
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Desconectar plataforma' })
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.connectionsService.remove(tenantId, id)
  }
}
