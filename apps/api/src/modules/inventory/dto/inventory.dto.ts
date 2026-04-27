import { IsNumber, IsString, IsOptional, IsEnum, Min } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'

export class UpdateInventoryDto {
  @ApiProperty({ description: 'Nueva cantidad en stock' })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  quantity: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  reason?: string
}

export class StockMovementDto {
  @ApiProperty()
  @IsString()
  inventoryId: string

  @ApiProperty({ enum: ['in', 'out', 'adjustment'] })
  @IsString()
  type: string

  @ApiProperty()
  @IsNumber()
  @Type(() => Number)
  quantity: number

  @ApiProperty()
  @IsString()
  reason: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  reference?: string
}

export class InventoryQueryDto {
  @IsOptional() @Type(() => Number) page?: number = 1
  @IsOptional() @Type(() => Number) limit?: number = 20
  @IsOptional() search?: string
  @IsOptional() lowStock?: string
  @IsOptional() warehouseId?: string
}
