import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { ConnectionsService } from './connections.service'
import { CreateConnectionDto, UpdateConnectionDto } from './dto/connection.dto'
import { TenantId } from '../../common/decorators/tenant-id.decorator'

@ApiTags('Connections')
@ApiBearerAuth()
@Controller('connections')
export class ConnectionsController {
  constructor(private connectionsService: ConnectionsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar conexiones' })
  findAll(@TenantId() tenantId: string) {
    return this.connectionsService.findAll(tenantId)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener conexión por ID' })
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.connectionsService.findOne(tenantId, id)
  }

  @Get(':id/status')
  @ApiOperation({ summary: 'Estado de sincronización' })
  getStatus(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.connectionsService.getStatus(tenantId, id)
  }

  @Post()
  @ApiOperation({ summary: 'Conectar nueva plataforma' })
  create(@TenantId() tenantId: string, @Body() dto: CreateConnectionDto) {
    return this.connectionsService.create(tenantId, dto)
  }

  @Post(':id/sync')
  @ApiOperation({ summary: 'Disparar sincronización' })
  triggerSync(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.connectionsService.triggerSync(tenantId, id)
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
