import { IsString, IsOptional, IsBoolean, IsEnum, IsObject, IsNumber, Min, IsInt } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'

export enum WarehouseType {
  ONLINE = 'online',
  WAREHOUSE = 'warehouse',
  STORE = 'store',
  CUSTOM = 'custom',
}

export class CreateWarehouseDto {
  @ApiProperty({ example: 'Bodega Norte' })
  @IsString()
  name: string

  @ApiPropertyOptional({ enum: WarehouseType, default: WarehouseType.CUSTOM })
  @IsOptional()
  @IsEnum(WarehouseType)
  warehouseType?: WarehouseType = WarehouseType.CUSTOM

  @ApiPropertyOptional({ example: { street: 'Av. Ejemplo 123', city: 'Santiago' } })
  @IsOptional()
  @IsObject()
  address?: Record<string, any>
}

export class UpdateWarehouseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  address?: Record<string, any>

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean
}

export class StockTransferDto {
  @ApiProperty()
  @IsString()
  fromWarehouseId: string

  @ApiProperty()
  @IsString()
  toWarehouseId: string

  @ApiProperty()
  @IsString()
  productId: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  variantId?: string

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  quantity: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reference?: string
}

export class WarehouseQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsEnum(WarehouseType)
  warehouseType?: WarehouseType

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  active?: boolean
}
