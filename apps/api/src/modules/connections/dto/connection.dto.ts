import { IsString, IsOptional, IsObject, IsBoolean } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class CreateConnectionDto {
  @ApiProperty({ enum: ['ecommerce', 'marketplace', 'shipping'] })
  @IsString()
  type: string

  @ApiProperty({
    enum: ['shopify', 'woocommerce', 'jumpseller', 'prestashop', 'mercadolibre', 'falabella', 'walmart', 'ripley', 'paris', 'custom'],
  })
  @IsString()
  provider: string

  @ApiProperty({ example: 'Mi tienda Shopify' })
  @IsString()
  name: string

  @ApiProperty({ description: 'Credenciales de la plataforma (API key, token, etc.)' })
  @IsObject()
  credentials: Record<string, string>

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>
}

export class UpdateConnectionDto {
  @IsOptional() @IsString() name?: string
  @IsOptional() @IsObject() credentials?: Record<string, string>
  @IsOptional() @IsObject() config?: Record<string, unknown>
  @IsOptional() @IsBoolean() syncEnabled?: boolean
}
