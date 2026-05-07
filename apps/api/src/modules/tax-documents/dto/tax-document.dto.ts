import { IsOptional, IsString } from 'class-validator'
import { Type } from 'class-transformer'
import { ApiProperty } from '@nestjs/swagger'

export class TaxDocumentQueryDto {
  @IsOptional() @Type(() => Number) page?: number = 1
  @IsOptional() @Type(() => Number) limit?: number = 20
  @IsOptional() search?: string
  // pending | issued | failed | cancelled
  @IsOptional() status?: string
  // boleta | factura | nota_credito
  @IsOptional() type?: string
  @IsOptional() emitter?: string
  @IsOptional() saleId?: string
  @IsOptional() orderId?: string
  @IsOptional() sortBy?: string = 'createdAt'
  @IsOptional() sortOrder?: 'asc' | 'desc' = 'desc'
}

export class EmitTaxDocumentDto {
  // Si se omite, el service decide en base a los datos de billing presentes:
  // si hay billingDocNumber + billingName → factura; si no → boleta.
  @ApiProperty({ required: false, enum: ['boleta', 'factura'] })
  @IsOptional()
  @IsString()
  type?: 'boleta' | 'factura'
}

export class CreditNoteDto {
  @ApiProperty({ required: false, default: 'Cancelación de la orden' })
  @IsOptional()
  @IsString()
  motive?: string
}

export class EmitBulkDto {
  @ApiProperty({ type: [String], description: 'IDs de Sale a facturar' })
  saleIds: string[]

  @ApiProperty({ required: false, enum: ['boleta', 'factura'] })
  @IsOptional()
  @IsString()
  type?: 'boleta' | 'factura'
}

// Para registrar manualmente un documento emitido fuera del sistema.
// Útil para órdenes legacy o cuando Bsale falló y se emitió por otra vía.
export class UploadManualDocumentDto {
  @ApiProperty() @IsString() saleId: string
  @ApiProperty({ enum: ['boleta', 'factura', 'nota_credito'] })
  @IsString()
  type: 'boleta' | 'factura' | 'nota_credito'

  @ApiProperty({ required: false }) @IsOptional() @IsString() folio?: string
  @ApiProperty({ required: false }) @IsOptional() @IsString() emittedAt?: string
}
