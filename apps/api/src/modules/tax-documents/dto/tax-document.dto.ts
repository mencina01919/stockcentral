import { IsOptional, IsString, IsArray, ArrayNotEmpty } from 'class-validator'
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
  // Rango por fecha real de la venta (sale.placedAt). ISO 8601.
  @IsOptional() placedFrom?: string
  @IsOptional() placedTo?: string
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

// Marca ventas como "cargada por otro medio" (DTE emitido fuera del sistema).
// NO interactúa con Bsale ni con el marketplace — solo crea un TaxDocument
// local con emitter='ml-external' para que la venta deje de aparecer en
// "Por facturar".
export class MarkExternalDto {
  @ApiProperty({ type: [String], description: 'IDs de Sale a marcar' })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  saleIds: string[]
}

export class EmitBulkDto {
  @ApiProperty({ type: [String], description: 'IDs de Sale a facturar' })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
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
