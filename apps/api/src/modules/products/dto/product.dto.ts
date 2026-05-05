import { IsString, IsNumber, IsOptional, IsArray, IsEnum, Min } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'

export enum ProductStatus {
  ACTIVE = 'active',
  OUT_OF_STOCK = 'out_of_stock',
  COMING_SOON = 'coming_soon',
  UNAVAILABLE = 'unavailable',
}

export class CreateProductDto {
  @ApiPropertyOptional({ description: 'Si se omite, se genera automáticamente' })
  @IsOptional()
  @IsString()
  sku?: string

  @ApiProperty()
  @IsString()
  name: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  brand?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  shortDescription?: string

  @ApiProperty()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  basePrice: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  costPrice?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  transferPrice?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  salePrice?: number

  @ApiPropertyOptional({ description: 'Margen deseado en %. Se calcula automáticamente si se omite.' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  targetMargin?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  weight?: number

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  tags?: string[]

  @ApiPropertyOptional({ enum: ProductStatus, default: ProductStatus.ACTIVE })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus = ProductStatus.ACTIVE

  @ApiPropertyOptional({ description: 'Stock inicial (bodega online)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  stockOnline?: number

  @ApiPropertyOptional({ description: 'Stock bodega principal' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  stockWarehouse?: number

  @ApiPropertyOptional({ description: 'Stock tienda física' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  stockStore?: number
}

export class UpdateProductDto {
  @IsOptional() @IsString() name?: string
  @IsOptional() @IsString() brand?: string
  @IsOptional() @IsString() description?: string
  @IsOptional() @IsString() shortDescription?: string
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) basePrice?: number
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) costPrice?: number
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) transferPrice?: number
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) salePrice?: number
  @IsOptional() @IsNumber() @Type(() => Number) targetMargin?: number
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) weight?: number
  @IsOptional() @IsArray() tags?: string[]
  @IsOptional() @IsArray() images?: any[]
  @IsOptional() @IsEnum(ProductStatus) status?: ProductStatus
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) stockOnline?: number
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) stockWarehouse?: number
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) stockStore?: number
}

export class ProductQueryDto {
  @IsOptional() @Type(() => Number) page?: number = 1
  @IsOptional() @Type(() => Number) limit?: number = 20
  @IsOptional() search?: string
  @IsOptional() status?: string
  @IsOptional() brand?: string
  @IsOptional() connectionId?: string
  @IsOptional() sortBy?: string = 'createdAt'
  @IsOptional() sortOrder?: 'asc' | 'desc' = 'desc'
}
