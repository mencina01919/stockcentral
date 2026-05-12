import { ApiProperty } from '@nestjs/swagger'
import {
  IsString,
  IsNumber,
  IsDateString,
  IsOptional,
  Min,
  Max,
  IsIn,
} from 'class-validator'

export class CreateOfferDto {
  @ApiProperty({ description: 'ID del producto' })
  @IsString()
  productId: string

  @ApiProperty({ description: 'ID de la conexión marketplace (ej. Falabella)' })
  @IsString()
  connectionId: string

  @ApiProperty({ description: 'Porcentaje de descuento (1-99)', example: 16 })
  @IsNumber()
  @Min(0.01)
  @Max(99)
  discountPct: number

  @ApiProperty({ description: 'Fecha inicio (ISO 8601)', example: '2026-05-12T00:00:00Z' })
  @IsDateString()
  startDate: string

  @ApiProperty({ description: 'Fecha fin (ISO 8601)', example: '2026-06-11T23:59:59Z' })
  @IsDateString()
  endDate: string

  @ApiProperty({ required: false, description: 'Notas internas' })
  @IsOptional()
  @IsString()
  notes?: string
}

export class UpdateOfferDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(99)
  discountPct?: number

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  startDate?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  endDate?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string
}

export class ListOffersQueryDto {
  @ApiProperty({ required: false, enum: ['scheduled', 'active', 'expired', 'cancelled'] })
  @IsOptional()
  @IsIn(['scheduled', 'active', 'expired', 'cancelled'])
  status?: 'scheduled' | 'active' | 'expired' | 'cancelled'

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  productId?: string

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  connectionId?: string
}
