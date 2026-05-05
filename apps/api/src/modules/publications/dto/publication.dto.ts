import { IsString, IsObject, IsOptional } from 'class-validator'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class PublishProductDto {
  @ApiProperty({ description: 'Datos específicos del formulario del marketplace' })
  @IsObject()
  formData: Record<string, any>

  @ApiPropertyOptional({ description: 'URLs de imágenes a usar (master URL del módulo media)' })
  @IsOptional()
  imageUrls?: string[]
}

export class ValidatePublishDto {
  @ApiProperty({ description: 'Payload tal como sería enviado a /items de ML' })
  @IsObject()
  payload: Record<string, any>
}
