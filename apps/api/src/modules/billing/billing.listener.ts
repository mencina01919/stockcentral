import { Injectable, Logger } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bull'
import { Queue } from 'bull'
import { BILLING_QUEUE, BillingJobType } from './billing.constants'

// Punto de entrada del módulo de facturación. El SyncService (y eventualmente
// los webhooks inbound de marketplaces) llaman a estos métodos cuando detectan
// transiciones relevantes en una orden. Aquí decidimos si encolamos un job.
//
// Reglas:
// - paymentStatus: pending → paid    => emitir documento
// - internalStatus: * → cancelled_internal con doc emitido => emitir NC
//
// El listener no toca la DB ni el emisor; solo encola. Toda la lógica vive en
// BillingProcessor + TaxDocumentsService.
@Injectable()
export class BillingListener {
  private readonly logger = new Logger(BillingListener.name)

  constructor(@InjectQueue(BILLING_QUEUE) private readonly queue: Queue) {}

  async onOrderTransition(input: {
    tenantId: string
    orderId: string
    saleId: string | null
    prev: { paymentStatus: string; internalStatus: string }
    next: { paymentStatus: string; internalStatus: string }
  }) {
    const { tenantId, saleId, prev, next, orderId } = input
    if (!saleId) return

    if (prev.paymentStatus !== 'paid' && next.paymentStatus === 'paid') {
      this.logger.log(`Order ${orderId} paid → enqueueing emit-document for sale ${saleId}`)
      await this.queue.add(
        BillingJobType.EMIT_DOCUMENT,
        { tenantId, saleId, firstSeenAt: Date.now(), attempt: 1 },
        { attempts: 1, removeOnComplete: 100, removeOnFail: 200 },
      )
    }

    if (
      prev.internalStatus !== 'cancelled_internal' &&
      next.internalStatus === 'cancelled_internal'
    ) {
      this.logger.log(`Order ${orderId} cancelled → enqueueing maybe-credit-note for sale ${saleId}`)
      await this.queue.add(
        BillingJobType.EMIT_CREDIT_NOTE,
        { tenantId, saleId, attempt: 1 },
        { attempts: 1, removeOnComplete: 100, removeOnFail: 200 },
      )
    }
  }
}
