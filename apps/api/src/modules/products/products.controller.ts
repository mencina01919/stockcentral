import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { ProductsService } from './products.service'
import { SyncService } from '../sync/sync.service'
import { CreateProductDto, UpdateProductDto, ProductQueryDto } from './dto/product.dto'
import { TenantId } from '../../common/decorators/tenant-id.decorator'

@ApiTags('Products')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
  constructor(
    private productsService: ProductsService,
    private syncService: SyncService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar productos' })
  findAll(@TenantId() tenantId: string, @Query() query: ProductQueryDto) {
    return this.productsService.findAll(tenantId, query)
  }

  @Get('stats')
  @ApiOperation({ summary: 'Estadísticas de productos' })
  getStats(@TenantId() tenantId: string) {
    return this.productsService.getStats(tenantId)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener producto por ID' })
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.productsService.findOne(tenantId, id)
  }

  @Post()
  @ApiOperation({ summary: 'Crear producto' })
  create(@TenantId() tenantId: string, @Body() dto: CreateProductDto) {
    return this.productsService.create(tenantId, dto)
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar producto' })
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(tenantId, id, dto)
  }

  @Post(':id/push')
  @ApiOperation({ summary: 'Empujar producto a todos los marketplaces conectados' })
  push(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.syncService.pushProductToMarketplaces(tenantId, id)
  }

  @Get(':id/marketplaces')
  @ApiOperation({ summary: 'Estado de mappings y conexiones disponibles para el producto' })
  marketplaceStatus(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.productsService.marketplaceStatus(tenantId, id)
  }

  @Post(':id/marketplaces/:connectionId/detect')
  @ApiOperation({ summary: 'Buscar este SKU en el marketplace y vincular si existe' })
  detectMarketplace(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Param('connectionId') connectionId: string,
  ) {
    return this.productsService.detectMarketplace(tenantId, id, connectionId)
  }

  @Delete(':id/marketplaces/:connectionId')
  @ApiOperation({ summary: 'Desvincular el producto del marketplace (no elimina la publicación)' })
  unlinkMarketplace(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Param('connectionId') connectionId: string,
  ) {
    return this.productsService.unlinkMarketplace(tenantId, id, connectionId)
  }

  @Get('marketplace/:connectionId')
  @ApiOperation({ summary: 'Listar productos publicados en un marketplace (vía API del proveedor)' })
  marketplaceProducts(
    @TenantId() tenantId: string,
    @Param('connectionId') connectionId: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    return this.productsService.fetchMarketplaceProducts(
      tenantId,
      connectionId,
      offset ? parseInt(offset, 10) : 0,
      limit ? parseInt(limit, 10) : 25,
    )
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Archivar producto' })
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.productsService.remove(tenantId, id)
  }
}
