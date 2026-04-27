import { IsString, IsOptional, IsObject, IsBoolean } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class CreateConnectionDto {
  @ApiPropertyOptional({ enum: ['ecommerce', 'marketplace', 'shipping'] })
  @IsOptional()
  type?: string

  @ApiProperty({
    enum: ['shopify', 'woocommerce', 'jumpseller', 'prestashop', 'mercadolibre', 'falabella', 'walmart', 'ripley', 'paris', 'custom'],
  })
  @IsString()
  provider: string

  @ApiPropertyOptional({ example: 'Mi tienda Shopify' })
  @IsOptional()
  @IsString()
  name?: string

  @ApiProperty({
    description: 'Credenciales según proveedor. Shopify: {shopDomain, accessToken}. WooCommerce: {siteUrl, consumerKey, consumerSecret}. Falabella: {userId, apiSecret}. Mercado Libre (sin OAuth): {accessToken, sellerId}.',
  })
  @IsObject()
  credentials: Record<string, string>

  @ApiPropertyOptional({ description: 'Configuración adicional (siteId, currency, listingType, etc.)' })
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

export class OAuthInitDto {
  @ApiProperty({ description: 'Client ID de la app registrada en el marketplace' })
  @IsString()
  clientId: string

  @ApiProperty({ description: 'Client Secret de la app' })
  @IsString()
  clientSecret: string

  @ApiPropertyOptional({ description: 'Redirect URI (por defecto usa el del servidor)' })
  @IsOptional()
  @IsString()
  redirectUri?: string

  @ApiPropertyOptional({ description: 'Shopify: dominio de la tienda (ej: mystore.myshopify.com)' })
  @IsOptional()
  @IsString()
  shopDomain?: string

  @ApiPropertyOptional({ description: 'ML: site ID (MLC=Chile, MLA=Argentina, MLB=Brasil)' })
  @IsOptional()
  @IsString()
  siteId?: string
}

export class OAuthCallbackDto {
  @IsString() code: string
  @IsOptional() @IsString() state?: string
}
