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

  @ApiProperty({
    description: 'Porcentaje de descuento (1-99). Requerido si no se pasa fixedSalePrice.',
    example: 16,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(99)
  discountPct?: number

  @ApiProperty({
    description: 'Precio de oferta fijo. Alternativa a discountPct. Si se pasa, el service calcula el % equivalente y persiste ambos.',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  fixedSalePrice?: number

  @ApiProperty({
    description: 'Si se pasa, sobreescribe `marketplacePricing[provider].calculatedPrice` del producto ANTES de crear la oferta. Útil cuando el operador ajusta el precio normal desde el modal de oferta.',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  overrideCalculatedPrice?: number

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
