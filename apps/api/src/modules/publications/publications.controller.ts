import { Controller, Get, Post, Delete, Body, Param, Query } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { PublicationsService } from './publications.service'
import { LiderSpecService } from './lider-spec.service'
import { MLMetadataService } from './ml-metadata.service'
import { FalabellaMetadataService } from './falabella-metadata.service'
import { PublishProductDto, ValidatePublishDto } from './dto/publication.dto'
import { TenantId } from '../../common/decorators/tenant-id.decorator'

@ApiTags('Publications')
@ApiBearerAuth()
@Controller('publications')
export class PublicationsController {
  constructor(
    private publicationsService: PublicationsService,
    private liderSpecService: LiderSpecService,
    private mlMetadata: MLMetadataService,
    private fbMetadata: FalabellaMetadataService,
  ) {}

  // ── MercadoLibre dynamic metadata ─────────────────────────────────────────

  @Get('ml/categories/search')
  @ApiOperation({ summary: 'Buscar categorías ML por keyword (domain_discovery)' })
  searchMLCategories(@Query('q') q: string) {
    return this.mlMetadata.searchCategories(q || '')
  }

  @Get('ml/categories/:categoryId/attributes')
  @ApiOperation({ summary: 'Atributos de una categoría ML, agrupados por requeridos/paquete/recomendados' })
  getMLCategoryAttributes(@Param('categoryId') categoryId: string) {
    return this.mlMetadata.getCategoryAttributes(categoryId)
  }

  @Get('ml/catalog/search')
  @ApiOperation({ summary: 'Buscar productos en catálogo ML para autocompletar publicación' })
  searchMLCatalog(
    @TenantId() tenantId: string,
    @Query('q') q: string,
    @Query('category') category?: string,
  ) {
    return this.mlMetadata.searchCatalogProducts(tenantId, q || '', category)
  }

  @Get('ml/catalog/:productId')
  @ApiOperation({ summary: 'Detalle de un producto del catálogo ML' })
  getMLCatalogProduct(@TenantId() tenantId: string, @Param('productId') productId: string) {
    return this.mlMetadata.getCatalogProduct(tenantId, productId)
  }

  @Post('ml/validate')
  @ApiOperation({ summary: 'Validar payload contra /items/validate de ML antes de publicar' })
  validateML(@TenantId() tenantId: string, @Body() dto: ValidatePublishDto) {
    return this.mlMetadata.validate(tenantId, dto.payload)
  }

  // ── Falabella dynamic metadata ────────────────────────────────────────────

  @Get('falabella/categories/tree')
  @ApiOperation({ summary: 'Árbol completo de categorías Falabella (cacheado)' })
  getFalabellaCategoryTree(@TenantId() tenantId: string) {
    return this.fbMetadata.getCategoryTree(tenantId)
  }

  @Get('falabella/categories/search')
  @ApiOperation({ summary: 'Buscar categorías Falabella por nombre (sobre el árbol cacheado)' })
  searchFalabellaCategories(@TenantId() tenantId: string, @Query('q') q: string) {
    return this.fbMetadata.searchCategories(tenantId, q || '')
  }

  @Get('falabella/categories/:categoryId/attributes')
  @ApiOperation({ summary: 'Atributos requeridos/opcionales para una categoría Falabella' })
  getFalabellaCategoryAttributes(@TenantId() tenantId: string, @Param('categoryId') categoryId: string) {
    return this.fbMetadata.getCategoryAttributes(tenantId, categoryId)
  }

  @Get('falabella/brands/search')
  @ApiOperation({ summary: 'Buscar marcas autorizadas en Falabella (cacheado)' })
  searchFalabellaBrands(@TenantId() tenantId: string, @Query('q') q?: string) {
    return this.fbMetadata.searchBrands(tenantId, q || '')
  }

  @Post('falabella/refresh')
  @ApiOperation({ summary: 'Forzar refresh de caches Falabella (categorías y marcas)' })
  refreshFalabellaCache(@TenantId() tenantId: string) {
    return this.fbMetadata.refreshCaches(tenantId)
  }

  // ── Generic marketplace form schemas ──────────────────────────────────────

  @Get('forms')
  @ApiOperation({ summary: 'Obtener todos los schemas de formulario por marketplace' })
  getAllForms() {
    return this.publicationsService.getAllFormSchemas()
  }

  @Get('forms/:provider')
  @ApiOperation({ summary: 'Schema de formulario para un marketplace específico (no-Lider)' })
  getForm(@Param('provider') provider: string) {
    return this.publicationsService.getFormSchema(provider)
  }

  // ── Lider dynamic spec endpoints ──────────────────────────────────────────

  @Get('lider/product-types')
  @ApiOperation({ summary: 'Lista de categorías (product types) de Walmart Chile según Item Spec 4.3' })
  getLiderProductTypes() {
    return this.liderSpecService.getProductTypes()
  }

  @Get('lider/form/:productType')
  @ApiOperation({ summary: 'Campos del formulario para una categoría específica de Lider/Walmart' })
  getLiderForm(@Param('productType') productType: string) {
    const decoded = decodeURIComponent(productType)
    return {
      provider: 'lider',
      productType: decoded,
      fields: this.liderSpecService.getFormFields(decoded),
    }
  }

  // ── Publication CRUD ──────────────────────────────────────────────────────

  @Get('product/:productId')
  @ApiOperation({ summary: 'Estado de publicación del producto en todos los marketplaces' })
  getProductPublications(@TenantId() tenantId: string, @Param('productId') productId: string) {
    return this.publicationsService.getProductPublications(tenantId, productId)
  }

  @Post('product/:productId/connection/:connectionId')
  @ApiOperation({ summary: 'Publicar o actualizar producto en un marketplace' })
  publish(
    @TenantId() tenantId: string,
    @Param('productId') productId: string,
    @Param('connectionId') connectionId: string,
    @Body() dto: PublishProductDto,
  ) {
    return this.publicationsService.publish(tenantId, productId, connectionId, dto)
  }

  @Delete('product/:productId/connection/:connectionId')
  @ApiOperation({ summary: 'Desvincular producto de un marketplace' })
  unpublish(
    @TenantId() tenantId: string,
    @Param('productId') productId: string,
    @Param('connectionId') connectionId: string,
  ) {
    return this.publicationsService.unpublish(tenantId, productId, connectionId)
  }
}
