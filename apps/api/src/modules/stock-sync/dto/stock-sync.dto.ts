import { IsString, IsOptional } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class ApplySyncDto {
  @ApiProperty({ description: 'ID del producto maestro' })
  @IsString()
  productId: string

  @ApiProperty({ description: 'ID del producto en el marketplace' })
  @IsString()
  marketplaceProductId: string

  @ApiPropertyOptional({ description: 'SKU del producto en el marketplace' })
  @IsOptional()
  @IsString()
  marketplaceSku?: string
}
