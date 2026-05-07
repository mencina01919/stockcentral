import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common'
import * as crypto from 'crypto'
import { PrismaService } from '../../prisma/prisma.service'
import { SyncService } from '../sync/sync.service'

// Recepción de webhooks desde marketplaces (push notifications). Hoy el flujo
// principal es el cron de sync; este módulo reduce la latencia entregando
// señal inmediata cuando un marketplace empuja un cambio.
//
// Estrategia minimalista por driver:
// - Verificación por HMAC-SHA256 sobre el body crudo, contra el secreto que
//   el operador configura en `Connection.config.webhookSecret`. Si no hay
//   secreto configurado, el webhook se acepta pero queda marcado como
//   no-verificado (para no romper provisioning de cuentas que aún no firman).
// - Idempotencia: dedup por (provider, externalEventId).
// - Procesamiento: encola un sync puntual del provider con `since` reciente
//   para hidratar la(s) orden(es) afectada(s). El BillingListener se dispara
//   automáticamente al detectar la transición.

const RECENT_SYNC_WINDOW_MS = 30 * 60 * 1000

@Injectable()
export class InboundWebhooksService {
  private readonly logger = new Logger(InboundWebhooksService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: SyncService,
  ) {}

  async handle(
    provider: string,
    rawBody: Buffer,
    parsedBody: any,
    headers: Record<string, string | string[] | undefined>,
    queryTenantId?: string,
  ) {
    // Resolver tenant. Por seguridad, si el query no trae tenantId, intentamos
    // resolver por el contenido. ML manda user_id; otros mandan resource path.
    const tenantId = await this.resolveTenant(provider, parsedBody, queryTenantId)
    if (!tenantId) {
      throw new BadRequestException('No se pudo resolver el tenant para este webhook')
    }

    const connection = await this.prisma.connection.findFirst({
      where: { tenantId, provider },
    })
    if (!connection) {
      throw new NotFoundException(`No hay conexión "${provider}" para tenant ${tenantId}`)
    }

    // Verificación de firma. Cada provider tiene su propio header; aceptamos
    // los más comunes y, si no hay match, intentamos cualquier header que
    // contenga "signature".
    const config = (connection.config || {}) as any
    const secret: string | undefined = config.webhookSecret
    const signatureHeader =
      this.headerValue(headers, 'x-signature') ||
      this.headerValue(headers, 'x-hmac-sha256') ||
      this.headerValue(headers, 'x-stockcentral-signature') ||
      this.headerValue(headers, 'x-falabella-signature')

    let signatureValid = false
    if (secret && signatureHeader) {
      const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
      const got = signatureHeader.replace(/^sha256=/, '')
      try {
        signatureValid = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(got))
      } catch {
        signatureValid = false
      }
    } else {
      // Sin secreto configurado: aceptamos pero no marcamos como verified.
      this.logger.warn(
        `Webhook ${provider} para tenant ${tenantId} aceptado sin verificación (config.webhookSecret no configurado).`,
      )
    }

    const externalEventId = this.extractEventId(provider, parsedBody, headers)
    const externalResourceId = this.extractResourceId(provider, parsedBody)
    const topic = this.extractTopic(provider, parsedBody, headers)

    // Idempotencia.
    if (externalEventId) {
      const existing = await this.prisma.marketplaceWebhookEvent.findUnique({
        where: { provider_externalEventId: { provider, externalEventId } },
      })
      if (existing) {
        this.logger.debug(`Webhook duplicado ${provider}/${externalEventId} — ignorando`)
        return { ok: true, deduped: true }
      }
    }

    const event = await this.prisma.marketplaceWebhookEvent.create({
      data: {
        tenantId,
        provider,
        externalEventId,
        topic,
        externalResourceId,
        payload: parsedBody as any,
        headers: this.sanitizeHeaders(headers) as any,
        signatureValid,
        status: 'received',
      },
    })

    // Procesamiento: encolamos un sync inbound del provider con ventana
    // reciente. Esto hidratará la(s) orden(es) afectadas y dispara el
    // BillingListener si hay transición.
    try {
      const since = new Date(Date.now() - RECENT_SYNC_WINDOW_MS)
      await this.sync.enqueueOrdersInbound(tenantId, connection.id, since)
      await this.prisma.marketplaceWebhookEvent.update({
        where: { id: event.id },
        data: { status: 'processed', processedAt: new Date() },
      })
    } catch (err: any) {
      this.logger.error(`Webhook ${provider} sync trigger failed: ${err?.message || err}`)
      await this.prisma.marketplaceWebhookEvent.update({
        where: { id: event.id },
        data: { status: 'failed', error: String(err?.message || err).slice(0, 500) },
      })
    }

    return { ok: true, eventId: event.id, signatureValid }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private headerValue(
    headers: Record<string, string | string[] | undefined>,
    key: string,
  ): string | undefined {
    const v = headers[key.toLowerCase()] || headers[key]
    if (Array.isArray(v)) return v[0]
    return v
  }

  // No persistimos headers sensibles en la DB.
  private sanitizeHeaders(headers: Record<string, string | string[] | undefined>) {
    const safe: Record<string, string> = {}
    for (const [k, v] of Object.entries(headers)) {
      if (!v) continue
      if (/cookie|authorization/i.test(k)) continue
      safe[k] = Array.isArray(v) ? v.join(', ') : v
    }
    return safe
  }

  // Resolución del tenant. Tres estrategias, en orden:
  //  1) ?tenantId=... en el query (cuando el operador registra el webhook
  //     usando una URL específica del tenant: /webhooks/in/ml?tenantId=X).
  //  2) Resolver por user_id (ML).
  //  3) Si solo hay un tenant con conexión `provider`, usar ese.
  private async resolveTenant(
    provider: string,
    body: any,
    queryTenantId?: string,
  ): Promise<string | null> {
    if (queryTenantId) return queryTenantId

    if (provider === 'mercadolibre' && body?.user_id) {
      const conn = await this.prisma.connection.findFirst({
        where: {
          provider,
          credentials: { path: ['sellerId'], equals: String(body.user_id) },
        },
      })
      if (conn) return conn.tenantId
    }

    const matches = await this.prisma.connection.findMany({
      where: { provider },
      select: { tenantId: true },
      take: 2,
    })
    if (matches.length === 1) return matches[0].tenantId

    return null
  }

  private extractEventId(
    provider: string,
    body: any,
    headers: Record<string, string | string[] | undefined>,
  ): string | undefined {
    if (provider === 'mercadolibre') {
      // ML manda { _id, resource, topic, user_id, ... }
      return body?._id ? String(body._id) : undefined
    }
    const idHeader =
      this.headerValue(headers, 'x-event-id') || this.headerValue(headers, 'x-message-id')
    if (idHeader) return idHeader
    return body?.id ? String(body.id) : undefined
  }

  private extractResourceId(provider: string, body: any): string | undefined {
    if (provider === 'mercadolibre' && body?.resource) {
      // resource viene como "/orders/123456"
      const m = String(body.resource).match(/(\d+)$/)
      return m ? m[1] : undefined
    }
    return body?.orderId || body?.OrderId || body?.order_id
      ? String(body.orderId || body.OrderId || body.order_id)
      : undefined
  }

  private extractTopic(
    provider: string,
    body: any,
    headers: Record<string, string | string[] | undefined>,
  ): string | undefined {
    if (provider === 'mercadolibre') return body?.topic
    return this.headerValue(headers, 'x-event-type') || body?.event || body?.topic
  }
}
