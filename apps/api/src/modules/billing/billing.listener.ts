import { Injectable, Logger } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bull'
import { Queue } from 'bull'
import { PrismaService } from '../../prisma/prisma.service'
import { BILLING_QUEUE, BillingJobType } from './billing.constants'

// Punto de entrada del módulo de facturación. El SyncService (y eventualmente
// los webhooks inbound de marketplaces) llaman a estos métodos cuando detectan
// transiciones relevantes en una orden. Aquí decidimos si encolamos un job.
//
// Reglas:
// - paymentStatus: pending → paid    => emitir documento (si autoEmit=true)
// - internalStatus: * → cancelled_internal con doc emitido => emitir NC
//   (si autoEmit=true; con autoEmit=false la cancelación se ignora hasta que
//   el operador habilite el flujo automático)
//
// El listener no toca la DB ni el emisor; solo encola. Toda la lógica vive en
// BillingProcessor + TaxDocumentsService.
@Injectable()
export class BillingListener {
  private readonly logger = new Logger(BillingListener.name)

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(BILLING_QUEUE) private readonly queue: Queue,
  ) {}

  async onOrderTransition(input: {
    tenantId: string
    orderId: string
    saleId: string | null
    prev: { paymentStatus: string; internalStatus: string }
    next: { paymentStatus: string; internalStatus: string }
  }) {
    const { tenantId, saleId, prev, next, orderId } = input
    if (!saleId) return

    const wantsEmit = prev.paymentStatus !== 'paid' && next.paymentStatus === 'paid'
    const wantsCreditNote =
      prev.internalStatus !== 'cancelled_internal' &&
      next.internalStatus === 'cancelled_internal'

    if (!wantsEmit && !wantsCreditNote) return

    // Respetar el flag autoEmit de la conexión Bsale del tenant. Si la
    // conexión no existe, no encolamos nada: el operador la configurará
    // cuando esté listo.
    const billingConnection = await this.prisma.connection.findFirst({
      where: { tenantId, type: 'billing' },
    })
    if (!billingConnection) {
      this.logger.debug(
        `Tenant ${tenantId} no tiene conexión de facturación — no se encola nada`,
      )
      return
    }
    const autoEmit = (billingConnection.config as any)?.autoEmit
    if (autoEmit !== true) {
      this.logger.debug(
        `Tenant ${tenantId} tiene autoEmit=false en ${billingConnection.provider} — emisión automática deshabilitada (sale ${saleId})`,
      )
      return
    }

    // Guarda contra backlog: emitFromDate define desde qué momento las
    // órdenes se emiten automáticamente. Sales con createdAt anterior se
    // ignoran (deben emitirse manualmente desde la UI). Sin emitFromDate
    // configurado, emite cualquier orden (no recomendado en cuentas con
    // muchas ventas históricas).
    const emitFromDateRaw = (billingConnection.config as any)?.emitFromDate
    if (emitFromDateRaw) {
      const emitFromDate = new Date(emitFromDateRaw)
      if (!Number.isNaN(emitFromDate.getTime())) {
        const sale = await this.prisma.sale.findUnique({
          where: { id: saleId },
          select: { createdAt: true },
        })
        if (sale && sale.createdAt < emitFromDate) {
          this.logger.debug(
            `Sale ${saleId} createdAt ${sale.createdAt.toISOString()} < emitFromDate ${emitFromDate.toISOString()} — skip auto-emit`,
          )
          return
        }
      }
    }

    if (wantsEmit) {
      this.logger.log(`Order ${orderId} paid → enqueueing emit-document for sale ${saleId}`)
      await this.queue.add(
        BillingJobType.EMIT_DOCUMENT,
        { tenantId, saleId, firstSeenAt: Date.now(), attempt: 1 },
        { attempts: 1, removeOnComplete: 100, removeOnFail: 200 },
      )
    }

    if (wantsCreditNote) {
      this.logger.log(`Order ${orderId} cancelled → enqueueing maybe-credit-note for sale ${saleId}`)
      await this.queue.add(
        BillingJobType.EMIT_CREDIT_NOTE,
        { tenantId, saleId, attempt: 1 },
        { attempts: 1, removeOnComplete: 100, removeOnFail: 200 },
      )
    }
  }

  // Llamado por TaxDocumentsService cuando un documento pasa a `issued`.
  // Encola el upload al marketplace si la conexión de facturación tiene
  // `pushToMarketplace: true`. Hoy solo ML soporta el upload (ver el job).
  async onTaxDocumentIssued(tenantId: string, taxDocumentId: string) {
    const billing = await this.prisma.connection.findFirst({
      where: { tenantId, type: 'billing' },
    })
    if (!billing) return
    const pushToMarketplace = (billing.config as any)?.pushToMarketplace
    if (pushToMarketplace !== true) {
      this.logger.debug(
        `Tenant ${tenantId} tiene pushToMarketplace=false — no se sube DTE al marketplace`,
      )
      return
    }
    await this.enqueuePushToMarketplace(tenantId, taxDocumentId)
  }

  // Encola un job EMIT_NOW para emisión manual disparada por el operador
  // (botón "Emitir DTE" en la UI o selección masiva). El delay permite
  // espaciar emisiones bulk para no saturar Bsale.
  async enqueueEmitNow(
    tenantId: string,
    saleId: string,
    type?: 'boleta' | 'factura',
    delay = 0,
  ) {
    await this.queue.add(
      BillingJobType.EMIT_NOW,
      { tenantId, saleId, type },
      { delay, attempts: 1, removeOnComplete: 100, removeOnFail: 200 },
    )
  }

  // Encola el job de push directamente, sin chequear flags. Usado por el
  // endpoint manual /tax-documents/:id/push-to-marketplace para forzar el
  // upload de un documento ya emitido.
  async enqueuePushToMarketplace(tenantId: string, taxDocumentId: string) {
    this.logger.log(
      `TaxDocument ${taxDocumentId} → enqueueing push-to-marketplace`,
    )
    await this.queue.add(
      BillingJobType.PUSH_TO_MARKETPLACE,
      { tenantId, taxDocumentId, attempt: 1 },
      { attempts: 1, removeOnComplete: 100, removeOnFail: 200 },
    )
  }
}
