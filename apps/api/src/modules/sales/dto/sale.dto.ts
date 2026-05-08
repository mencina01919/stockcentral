import { IsOptional, IsString } from 'class-validator'
import { Type } from 'class-transformer'

export class SaleQueryDto {
  @IsOptional() @Type(() => Number) page?: number = 1
  @IsOptional() @Type(() => Number) limit?: number = 20
  @IsOptional() search?: string
  @IsOptional() status?: string
  @IsOptional() source?: string
  @IsOptional() invoiceType?: string
  @IsOptional() paymentStatus?: string
  // 'true' para devolver sólo ventas con más de una orden agrupada (packs)
  @IsOptional() multiOrder?: string
  // 'true' para tab "Por facturar": ventas pagadas que aún no tienen
  // documento tributario emitido o pendiente.
  @IsOptional() pendingBilling?: string
  // Rango de fecha real (placedAt). ISO 8601. Inclusivos.
  @IsOptional() placedFrom?: string
  @IsOptional() placedTo?: string
  @IsOptional() sortBy?: string = 'createdAt'
  @IsOptional() sortOrder?: 'asc' | 'desc' = 'desc'
}
