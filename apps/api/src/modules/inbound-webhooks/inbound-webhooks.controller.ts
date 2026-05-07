import { Controller, Post, Param, Body, Headers, Query, Req } from '@nestjs/common'
import { ApiTags, ApiOperation } from '@nestjs/swagger'
import { RawBodyRequest } from '@nestjs/common'
import { Request } from 'express'
import { InboundWebhooksService } from './inbound-webhooks.service'
import { Public } from '../../common/decorators/public.decorator'

// Endpoint público para que los marketplaces empujen notificaciones. Cada
// marketplace tiene su propio formato de payload y firma; el service
// resuelve tenant + verifica + dispara sync puntual.
//
// URL típica para registrar en cada marketplace:
//   https://<api>/api/v1/webhooks/in/<provider>?tenantId=<uuid>
@ApiTags('Inbound Webhooks')
@Controller('webhooks/in')
export class InboundWebhooksController {
  constructor(private service: InboundWebhooksService) {}

  @Public()
  @Post(':provider')
  @ApiOperation({ summary: 'Recibir webhook desde un marketplace' })
  async receive(
    @Param('provider') provider: string,
    @Body() body: any,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Req() req: RawBodyRequest<Request>,
    @Query('tenantId') tenantId?: string,
  ) {
    // req.rawBody existe gracias a `rawBody: true` en NestFactory.create.
    // Si por alguna razón no llega, lo reconstruimos del body parseado para
    // no romper el webhook (la firma quedará inválida).
    const raw =
      req.rawBody && Buffer.isBuffer(req.rawBody)
        ? req.rawBody
        : Buffer.from(JSON.stringify(body || {}))
    return this.service.handle(provider, raw, body, headers, tenantId)
  }
}
