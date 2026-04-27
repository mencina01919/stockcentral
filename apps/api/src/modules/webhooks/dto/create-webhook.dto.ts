import { IsString, IsUrl, IsArray, IsBoolean, IsOptional, ArrayNotEmpty } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export const WEBHOOK_EVENTS = [
  'order.created',
  'order.updated',
  'order.cancelled',
  'order.fulfilled',
  'product.created',
  'product.updated',
  'product.deleted',
  'inventory.low_stock',
  'inventory.out_of_stock',
  'sync.completed',
  'sync.failed',
] as const

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]

export class CreateWebhookDto {
  @ApiProperty({ example: 'https://myapp.com/webhooks/stockcentral' })
  @IsUrl()
  url: string

  @ApiProperty({ example: ['order.created', 'inventory.low_stock'] })
  @IsArray()
  @ArrayNotEmpty()
  events: string[]

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  active?: boolean
}

export class UpdateWebhookDto {
  @IsOptional()
  @IsUrl()
  url?: string

  @IsOptional()
  @IsArray()
  events?: string[]

  @IsOptional()
  @IsBoolean()
  active?: boolean
}

export class TestWebhookDto {
  @ApiProperty({ example: 'order.created' })
  @IsString()
  event: string
}
