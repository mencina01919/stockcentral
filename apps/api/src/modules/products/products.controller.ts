import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger'
import { ProductsService } from './products.service'
import { CreateProductDto, UpdateProductDto, ProductQueryDto } from './dto/product.dto'
import { TenantId } from '../../common/decorators/tenant-id.decorator'

@ApiTags('Products')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
  constructor(private productsService: ProductsService) {}

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

  @Delete(':id')
  @ApiOperation({ summary: 'Archivar producto' })
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.productsService.remove(tenantId, id)
  }
}
