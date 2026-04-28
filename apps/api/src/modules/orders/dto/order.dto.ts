import { IsString, IsNumber, IsOptional, IsArray, ValidateNested, Min } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'

export class CreateOrderItemDto {
  @ApiProperty() @IsString() sku: string
  @ApiProperty() @IsString() name: string
  @ApiProperty() @IsNumber() @Min(1) @Type(() => Number) quantity: number
  @ApiProperty() @IsNumber() @Min(0) @Type(() => Number) unitPrice: number
  @ApiProperty() @IsNumber() @Min(0) @Type(() => Number) totalPrice: number
  @IsOptional() @IsString() productId?: string
  @IsOptional() @IsString() variantId?: string
}

export class CreateOrderDto {
  @ApiProperty() @IsString() source: string
  @ApiProperty() @IsString() sourceChannel: string
  @ApiProperty({ required: false }) @IsOptional() @IsString() externalOrderId?: string
  @ApiProperty() @IsString() customerName: string
  @ApiProperty({ required: false }) @IsOptional() @IsString() customerEmail?: string
  @ApiProperty({ required: false }) @IsOptional() @IsString() customerPhone?: string
  @ApiProperty({ type: [CreateOrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[]
  @ApiProperty() @IsNumber() @Min(0) @Type(() => Number) subtotal: number
  @ApiProperty() @IsNumber() @Min(0) @Type(() => Number) total: number
  @ApiProperty({ required: false, default: 'CLP' }) @IsOptional() @IsString() currency?: string
  @ApiProperty({ required: false }) @IsOptional() @IsString() notes?: string
}

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: ['pending', 'confirmed', 'processing', 'fulfilled', 'completed', 'cancelled'] })
  @IsString()
  status: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  reason?: string
}

export class OrderQueryDto {
  @IsOptional() @Type(() => Number) page?: number = 1
  @IsOptional() @Type(() => Number) limit?: number = 20
  @IsOptional() search?: string
  @IsOptional() status?: string
  @IsOptional() source?: string
  @IsOptional() sourceChannel?: string
  @IsOptional() sortBy?: string = 'createdAt'
  @IsOptional() sortOrder?: 'asc' | 'desc' = 'desc'
}
