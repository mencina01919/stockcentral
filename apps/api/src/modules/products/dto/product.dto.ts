import { IsString, IsNumber, IsOptional, IsArray, IsEnum, Min } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'
import { Type } from 'class-transformer'

export class CreateProductDto {
  @ApiProperty()
  @IsString()
  sku: string

  @ApiProperty()
  @IsString()
  name: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  shortDescription?: string

  @ApiProperty()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  basePrice: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  costPrice?: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  weight?: number

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  tags?: string[]

  @ApiProperty({ required: false, default: 'draft', enum: ['draft', 'active', 'archived'] })
  @IsOptional()
  @IsString()
  status?: string
}

export class UpdateProductDto {
  @IsOptional() @IsString() name?: string
  @IsOptional() @IsString() description?: string
  @IsOptional() @IsString() shortDescription?: string
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) basePrice?: number
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) salePrice?: number
  @IsOptional() @IsString() saleStartDate?: string
  @IsOptional() @IsString() saleEndDate?: string
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) costPrice?: number
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) weight?: number
  @IsOptional() @IsArray() tags?: string[]
  @IsOptional() @IsArray() images?: string[]
  @IsOptional() @IsString() status?: string
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) stock?: number
}

export class ProductQueryDto {
  @IsOptional() @Type(() => Number) page?: number = 1
  @IsOptional() @Type(() => Number) limit?: number = 20
  @IsOptional() search?: string
  @IsOptional() status?: string
  @IsOptional() connectionId?: string
  @IsOptional() sortBy?: string = 'createdAt'
  @IsOptional() sortOrder?: 'asc' | 'desc' = 'desc'
}
