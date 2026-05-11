import { Processor, Process, OnQueueFailed, OnQueueCompleted, InjectQueue } from '@nestjs/bull'
import { Logger } from '@nestjs/common'
import { Job, Queue } from 'bull'
import axios from 'axios'
import { PrismaService } from '../../prisma/prisma.service'
import { TaxDocumentsService } from '../tax-documents/tax-documents.service'
import { MercadoLibreDriver } from '@stockcentral/integrations'
import {
  BILLING_QUEUE,
  BillingJobType,
  FACTURA_WAIT_MS,
  RETRY_BACKOFF_MS,
  MAX_RETRY_ATTEMPTS,
  BULK_EMIT_THROTTLE_MS,
} from './billing.constants'

interface EmitDocumentJob {
  tenantId: string
  saleId: string
  firstSeenAt: number
  attempt: number
}

interface EmitCreditNoteJob {
  tenantId: string
  saleId: string
  attempt: number
}

interface PushToMarketplaceJob {
  tenantId: string
  taxDocumentId: string
  attempt: number
}

interface EmitNowJob {
  tenantId: string
  saleId: string
  type?: 'boleta' | 'factura'
}

@Processor(BILLING_QUEUE)
export class BillingProcessor {
  private readonly logger = new Logger(BillingProcessor.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly taxDocs: TaxDocumentsService,
    @InjectQueue(BILLING_QUEUE) private readonly queue: Queue,
  ) {}

  @Process(BillingJobType.EMIT_DOCUMENT)
  async handleEmitDocument(job: Job<EmitDocumentJob>) {
    const { tenantId, saleId, firstSeenAt, attempt } = job.data

    // Idempotencia: si ya hay un documento issued/pending, no emitimos otro.
    const already = await this.prisma.taxDocument.findFirst({
      where: {
        tenantId,
        saleId,
        type: { in: ['boleta', 'factura'] },
        status: { in: ['issued', 'pending'] },
      },
    })
    if (already) {
      this.logger.debug(`Sale ${saleId} ya tiene doc ${already.status} (${already.id}) — skip`)
      return
    }

    const sale = await this.prisma.sale.findFirst({ where: { id: saleId, tenantId } })
    if (!sale) {
      this.logger.warn(`Sale ${saleId} no encontrada — skip`)
      return
    }

    // SOLO `sale.invoiceType === 'factura'` es señal real de que el comprador
    // pidió factura. El sync ya deriva eso de marcas explícitas del
    // marketplace (en ML: presencia de BUSINESS_NAME o ECONOMIC_ACTIVITY en
    // billing_info.additional_info; en Paris: businessInvoice; etc.).
    //
    // NO usar `!!sale.billingDocNumber` como señal: ML retorna el RUT del
    // comprador en billing_info.doc_number por defecto, aunque la persona
    // haya pedido BOLETA. Si tratáramos billingDocNumber como "quiere
    // factura", todas las boletas a personas naturales se emitirían como
    // facturas mal y habría que NC + re-emitir.
    const wantsFactura = sale.invoiceType === 'factura'
    const hasFacturaData = !!sale.billingDocNumber && !!sale.billingName
    const elapsed = Date.now() - firstSeenAt
    const expired = elapsed >= FACTURA_WAIT_MS

    let type: 'boleta' | 'factura'
    if (wantsFactura && hasFacturaData) {
      type = 'factura'
    } else if (wantsFactura && !hasFacturaData && !expired) {
      // Falta el RUT para emitir factura. Re-encolamos con delay para volver a
      // chequear más tarde. El sync intermedio puede haber rellenado los datos.
      this.logger.log(
        `Sale ${saleId} pendiente de datos de factura (${Math.round(elapsed / 60000)}min) — reintento en 1h`,
      )
      await this.queue.add(
        BillingJobType.EMIT_DOCUMENT,
        { tenantId, saleId, firstSeenAt, attempt: attempt + 1 },
        {
          delay: RETRY_BACKOFF_MS,
          attempts: 1,
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      )
      return
    } else {
      // Pasaron 24h sin datos de factura, o nunca se pidió factura: emitir boleta.
      type = 'boleta'
      if (wantsFactura && expired) {
        this.logger.warn(
          `Sale ${saleId} timeout 24h sin datos de factura → degradando a boleta`,
        )
      }
    }

    try {
      const doc = await this.taxDocs.emitForSale(tenantId, saleId, { type })
      this.logger.log(
        `Documento emitido: sale=${saleId} type=${type} folio=${doc.folio || '-'} id=${doc.id}`,
      )
    } catch (err: any) {
      this.logger.error(`Emisión falló sale=${saleId}: ${err?.message || err}`)
      if (attempt < MAX_RETRY_ATTEMPTS) {
        const delay = RETRY_BACKOFF_MS * Math.pow(2, attempt - 1)
        this.logger.log(`Reintento ${attempt + 1}/${MAX_RETRY_ATTEMPTS} en ${delay / 60000}min`)
        await this.queue.add(
          BillingJobType.EMIT_DOCUMENT,
          { tenantId, saleId, firstSeenAt, attempt: attempt + 1 },
          {
            delay,
            attempts: 1,
            removeOnComplete: 100,
            removeOnFail: 200,
          },
        )
      }
      // El emitForSale ya marcó el TaxDocument como failed con lastError, así
      // que no propagamos el throw para no llenar Bull de jobs failed.
    }
  }

  @Process(BillingJobType.EMIT_CREDIT_NOTE)
  async handleEmitCreditNote(job: Job<EmitCreditNoteJob>) {
    const { tenantId, saleId, attempt } = job.data

    // Buscamos el DTE issued más reciente (boleta o factura) para esta sale.
    // Una sale puede tener varios docs a lo largo del tiempo (ej. factura
    // emitida por bug → NC → boleta correcta re-emitida). Tomamos el más
    // reciente para que la NC referencie al doc vigente, no a uno histórico
    // ya anulado.
    const original = await this.prisma.taxDocument.findFirst({
      where: {
        tenantId,
        saleId,
        type: { in: ['boleta', 'factura'] },
        status: 'issued',
      },
      orderBy: { createdAt: 'desc' },
    })
    if (!original) {
      // Cancelación antes de emitir: no hacer nada (regla del contrato).
      this.logger.debug(`Sale ${saleId} cancelada sin doc previo — sin NC`)
      return
    }

    // Idempotencia por documento original, no por sale: una sale puede tener
    // ya una NC vieja sobre un doc previo (ej. NC sobre factura emitida por
    // bug) y aun así necesitar otra NC sobre el doc actual cuando el
    // comprador cancela. Sin este filtro, el processor saltaría la nueva NC
    // por encontrar la vieja.
    const existingNc = await this.prisma.taxDocument.findFirst({
      where: {
        tenantId,
        saleId,
        type: 'nota_credito',
        status: { in: ['issued', 'pending'] },
        referenceDocumentId: original.id,
      },
    })
    if (existingNc) {
      this.logger.debug(
        `Sale ${saleId} ya tiene NC ${existingNc.status} sobre doc ${original.id} — skip`,
      )
      return
    }

    try {
      const nc = await this.taxDocs.emitCreditNoteForSale(tenantId, saleId, {
        motive: 'Cancelación de la orden marketplace',
      })
      this.logger.log(`NC emitida: sale=${saleId} folio=${nc.folio || '-'} id=${nc.id}`)
    } catch (err: any) {
      this.logger.error(`NC falló sale=${saleId}: ${err?.message || err}`)
      if (attempt < MAX_RETRY_ATTEMPTS) {
        const delay = RETRY_BACKOFF_MS * Math.pow(2, attempt - 1)
        await this.queue.add(
          BillingJobType.EMIT_CREDIT_NOTE,
          { tenantId, saleId, attempt: attempt + 1 },
          { delay, attempts: 1, removeOnComplete: 100, removeOnFail: 200 },
        )
      }
    }
  }

  // ─── PUSH_TO_MARKETPLACE ─────────────────────────────────────────────────
  // Sube el PDF del DTE emitido a la orden del marketplace. Hoy solo ML lo
  // soporta; otros providers se ignoran silenciosamente. Idempotente: si el
  // metadata.marketplaceUpload.success ya está, no re-sube.
  @Process(BillingJobType.PUSH_TO_MARKETPLACE)
  async handlePushToMarketplace(job: Job<PushToMarketplaceJob>) {
    const { tenantId, taxDocumentId, attempt } = job.data

    const doc = await this.prisma.taxDocument.findFirst({
      where: { id: taxDocumentId, tenantId },
      include: {
        sale: { include: { orders: true } },
      },
    })
    if (!doc) {
      this.logger.warn(`PUSH_TO_MARKETPLACE: doc ${taxDocumentId} no encontrado`)
      return
    }
    if (doc.status !== 'issued' || !doc.pdfUrl) {
      this.logger.debug(
        `PUSH_TO_MARKETPLACE: doc ${doc.id} status=${doc.status} pdfUrl=${doc.pdfUrl} — skip`,
      )
      return
    }
    const meta = (doc.metadata as any) || {}
    if (meta?.marketplaceUpload?.success) {
      this.logger.debug(`PUSH_TO_MARKETPLACE: doc ${doc.id} ya subido — skip`)
      return
    }

    const orders = doc.sale?.orders || []
    // Filtramos órdenes ML; otras quedan para futuras integraciones.
    const mlOrders = orders.filter((o) => o.source === 'mercadolibre')
    if (mlOrders.length === 0) {
      this.logger.debug(
        `PUSH_TO_MARKETPLACE: doc ${doc.id} no tiene órdenes ML — skip (otros marketplaces no soportan upload)`,
      )
      return
    }

    // Resolver credenciales ML del tenant.
    const mlConn = await this.prisma.connection.findFirst({
      where: { tenantId, provider: 'mercadolibre' },
    })
    if (!mlConn) {
      this.logger.warn(`PUSH_TO_MARKETPLACE: tenant ${tenantId} sin conexión ML`)
      return
    }

    // Descargar PDF del DTE.
    let pdfBuffer: Buffer
    try {
      const pdfRes = await axios.get(doc.pdfUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
      })
      pdfBuffer = Buffer.from(pdfRes.data)
    } catch (err: any) {
      this.logger.error(`PUSH_TO_MARKETPLACE: error descargando PDF ${doc.pdfUrl}: ${err?.message}`)
      await this.scheduleRetry(taxDocumentId, attempt, `download_failed: ${err?.message}`)
      return
    }

    const ml = new MercadoLibreDriver()
    const credentials = mlConn.credentials as Record<string, string>

    // Una NC puede aplicar a varias orders (caso pack); subimos a cada una.
    const results: Array<{
      packOrOrderId: string
      success: boolean
      error?: string
    }> = []
    for (const order of mlOrders) {
      const packOrOrderId = order.packId || order.externalOrderId
      if (!packOrOrderId) continue
      const r = await ml.uploadInvoice(credentials, {
        packOrOrderId,
        pdfBuffer,
        pdfFilename: `${doc.folio || doc.id}.pdf`,
      })
      results.push({ packOrOrderId, success: r.success, error: r.error })
      if (r.success) {
        this.logger.log(`PUSH_TO_MARKETPLACE: doc ${doc.id} → ML pack ${packOrOrderId} OK`)
      } else {
        this.logger.error(
          `PUSH_TO_MARKETPLACE: doc ${doc.id} → ML pack ${packOrOrderId} falló: ${r.error}`,
        )
      }
    }

    const allOk = results.every((r) => r.success)
    await this.prisma.taxDocument.update({
      where: { id: doc.id },
      data: {
        metadata: {
          ...meta,
          marketplaceUpload: {
            success: allOk,
            attempts: (meta?.marketplaceUpload?.attempts || 0) + 1,
            lastTriedAt: new Date().toISOString(),
            results,
          },
        } as any,
      },
    })

    if (!allOk && attempt < MAX_RETRY_ATTEMPTS) {
      await this.scheduleRetry(taxDocumentId, attempt, results.find((r) => !r.success)?.error)
    }
  }

  private async scheduleRetry(
    taxDocumentId: string,
    attempt: number,
    reason?: string,
  ) {
    const delay = RETRY_BACKOFF_MS * Math.pow(2, attempt - 1)
    this.logger.log(
      `PUSH_TO_MARKETPLACE: reintento ${attempt + 1}/${MAX_RETRY_ATTEMPTS} en ${delay / 60000}min ${reason ? `(${reason})` : ''}`,
    )
    const doc = await this.prisma.taxDocument.findUnique({ where: { id: taxDocumentId } })
    if (!doc) return
    await this.queue.add(
      BillingJobType.PUSH_TO_MARKETPLACE,
      { tenantId: doc.tenantId, taxDocumentId, attempt: attempt + 1 },
      { delay, attempts: 1, removeOnComplete: 100, removeOnFail: 200 },
    )
  }

  // ─── EMIT_NOW (manual, 1 doc o bulk) ─────────────────────────────────────
  // Disparado por el operador desde la UI (`/sales` botón emitir o selección
  // masiva). NO chequea autoEmit ni espera 24h: el operador ya decidió.
  // Idempotente: el service rechaza si ya hay doc issued/pending.
  @Process(BillingJobType.EMIT_NOW)
  async handleEmitNow(job: Job<EmitNowJob>) {
    const { tenantId, saleId, type } = job.data
    try {
      const doc = await this.taxDocs.emitForSale(tenantId, saleId, type ? { type } : {})
      this.logger.log(
        `EMIT_NOW: sale=${saleId} type=${doc.type} folio=${doc.folio || '-'} id=${doc.id}`,
      )
    } catch (err: any) {
      // Si la venta ya tiene doc o falla, lo logueamos pero no reintentamos
      // (el operador puede usar /retry desde la UI si quiere insistir).
      this.logger.warn(`EMIT_NOW falló sale=${saleId}: ${err?.message || err}`)
    }
  }

  @OnQueueFailed()
  onFailed(job: Job, err: Error) {
    this.logger.error(`Billing job ${job.id} (${job.name}) failed: ${err.message}`)
  }

  @OnQueueCompleted()
  onCompleted(job: Job) {
    this.logger.debug(`Billing job ${job.id} (${job.name}) completed`)
  }
}
