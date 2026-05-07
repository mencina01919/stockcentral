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
  @IsOptional() sortBy?: string = 'createdAt'
  @IsOptional() sortOrder?: 'asc' | 'desc' = 'desc'
}
