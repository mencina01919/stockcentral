import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as path from 'path'
import * as fs from 'fs'
import * as crypto from 'crypto'
import { PrismaService } from '../../prisma/prisma.service'
import {
  BsaleDriver,
  type ITaxDocumentEmitter,
  type EmitDocumentInput,
  type TaxClientInput,
  type TaxDocumentLineInput,
} from '@stockcentral/integrations'
// Escapa un valor para CSV: si contiene coma, comilla doble o salto de
// línea, lo envuelve en comillas y duplica las comillas internas. RFC 4180.
function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

import {
  TaxDocumentQueryDto,
  EmitTaxDocumentDto,
  CreditNoteDto,
  UploadManualDocumentDto,
  EmitBulkDto,
  MarkExternalDto,
} from './dto/tax-document.dto'
import { BillingListener } from '../billing/billing.listener'

// Multi-emisor: el provider del facturador se almacena en `Connection`. Cada
// driver implementa la misma interfaz, así que la decisión es tabla.
const EMITTERS: Record<string, () => ITaxDocumentEmitter> = {
  bsale: () => new BsaleDriver(),
}

@Injectable()
export class TaxDocumentsService {
  // Directorio en disco donde guardamos los PDFs subidos manualmente.
  // En prod este path se symlink-ea a /tax-documents y un proxy/CDN lo sirve.
  private readonly uploadsRoot: string
  private readonly mediaBaseUrl: string

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    // forwardRef para evitar el ciclo BillingModule ↔ TaxDocumentsModule.
    // BillingListener encola el push al marketplace tras emisión exitosa.
    @Inject(forwardRef(() => BillingListener))
    private billing: BillingListener,
  ) {
    this.uploadsRoot = path.join(process.cwd(), 'uploads', 'tax-documents')
    if (!fs.existsSync(this.uploadsRoot)) fs.mkdirSync(this.uploadsRoot, { recursive: true })

    const explicit = this.config.get<string>('MEDIA_BASE_URL')
    const apiUrl = this.config.get<string>('APP_URL', 'http://localhost:3001')
    this.mediaBaseUrl = (explicit || apiUrl).replace(/\/$/, '')
  }

  // ─── Listado / lectura ────────────────────────────────────────────────────

  // Buscador "amplio" del listado de documentos. El operador suele pegar lo
  // que tenga a mano (folio Bsale, saleNumber StockCentral, ID/pack/order
  // del marketplace, RUT, nombre del comprador, email…). Cubrimos todos esos
  // campos con OR para que la búsqueda funcione sin que tenga que pensar en
  // qué columna específica buscar.
  private buildSearchOr(search: string) {
    return [
      { folio: { contains: search, mode: 'insensitive' as const } },
      { externalId: { contains: search, mode: 'insensitive' as const } },
      { sale: { is: { saleNumber: { contains: search, mode: 'insensitive' as const } } } },
      { sale: { is: { customerName: { contains: search, mode: 'insensitive' as const } } } },
      { sale: { is: { customerDocNumber: { contains: search, mode: 'insensitive' as const } } } },
      { sale: { is: { billingName: { contains: search, mode: 'insensitive' as const } } } },
      { sale: { is: { billingDocNumber: { contains: search, mode: 'insensitive' as const } } } },
      { sale: { is: { customerEmail: { contains: search, mode: 'insensitive' as const } } } },
      {
        sale: {
          is: {
            orders: {
              some: {
                OR: [
                  { externalOrderId: { contains: search, mode: 'insensitive' as const } },
                  { orderNumber: { contains: search, mode: 'insensitive' as const } },
                  { packId: { contains: search, mode: 'insensitive' as const } },
                ],
              },
            },
          },
        },
      },
    ]
  }

  async findAll(tenantId: string, query: TaxDocumentQueryDto) {
    const {
      page = 1,
      limit = 20,
      search,
      status,
      type,
      emitter,
      saleId,
      orderId,
      situation,
      placedFrom,
      placedTo,
      sortBy = 'placedAt',
      sortOrder = 'desc',
    } = query
    const skip = (page - 1) * limit
    const where: any = { tenantId }
    if (status) where.status = status
    if (type) where.type = type
    if (emitter) where.emitter = emitter
    if (saleId) where.saleId = saleId
    if (orderId) where.orderId = orderId

    // Filtro por situación del marketplace (sólo ML hoy). Coincide cuando al
    // menos una de las orders de la sale tiene mediación / no entregada / etc.
    // Debe ir al inicio de where.AND para que los demás filtros se compongan.
    if (situation === 'mediation') {
      // hasMediations en metadata ya descuenta mediaciones cerradas.
      where.AND = [
        ...(where.AND || []),
        {
          sale: {
            is: {
              orders: {
                some: {
                  OR: [
                    { metadata: { path: ['hasMediations'], equals: true } },
                    { metadata: { path: ['statusDetail'], equals: 'mediation_open' } },
                  ],
                },
              },
            },
          },
        },
      ]
    } else if (situation === 'not_delivered') {
      where.AND = [
        ...(where.AND || []),
        {
          sale: {
            is: {
              orders: {
                some: {
                  AND: [
                    { NOT: { status: 'cancelled' } },
                    {
                      OR: [
                        { metadata: { path: ['statusDetail'], equals: 'not_delivered' } },
                        { metadata: { path: ['tags'], array_contains: ['not_delivered'] } },
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
      ]
    } else if (situation === 'cancelled_clean') {
      // Sale cuyas orders están todas cancelled pero ninguna en mediación
      // abierta — la cancelación "limpia".
      where.AND = [
        ...(where.AND || []),
        {
          sale: {
            is: {
              orders: {
                every: { status: 'cancelled' },
                none: {
                  OR: [
                    { metadata: { path: ['hasMediations'], equals: true } },
                    { metadata: { path: ['statusDetail'], equals: 'mediation_open' } },
                  ],
                },
              },
            },
          },
        },
      ]
    }
    if (search) where.OR = this.buildSearchOr(search)
    // Filtro por fecha real de la venta (sale.placedAt). Caemos a sale.createdAt
    // si placedAt es null (caso legacy).
    if (placedFrom || placedTo) {
      const range: Record<string, Date> = {}
      if (placedFrom) range.gte = new Date(placedFrom)
      if (placedTo) {
        const to = new Date(placedTo)
        if (placedTo.length <= 10) to.setUTCHours(23, 59, 59, 999)
        range.lte = to
      }
      where.AND = [
        ...(where.AND || []),
        {
          sale: {
            is: {
              OR: [{ placedAt: range }, { AND: [{ placedAt: null }, { createdAt: range }] }],
            },
          },
        },
      ]
    }

    // orderBy: cuando sortBy=placedAt, ordenamos por sale.placedAt con nulls
    // al final y como tiebreaker la fecha de creación del TaxDoc. Esto evita
    // que los TaxDocuments importados en bulk (mismo createdAt) se vean
    // mezclados — cada fila se ancla a la fecha real de la venta.
    let orderBy: any
    if (sortBy === 'placedAt') {
      orderBy = [
        { sale: { placedAt: { sort: sortOrder, nulls: 'last' } } },
        { createdAt: sortOrder },
      ]
    } else {
      orderBy = { [sortBy]: sortOrder }
    }

    const [data, total] = await Promise.all([
      this.prisma.taxDocument.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          sale: {
            select: {
              id: true,
              saleNumber: true,
              customerName: true,
              total: true,
              placedAt: true,
              createdAt: true,
              source: true,
              // Sólo el metadata + status de cada order: la UI deriva
              // mediación/reclamo/no-entregado de ahí (ver deriveSaleSituation).
              orders: {
                select: { status: true, internalStatus: true, metadata: true },
              },
            },
          },
          lines: true,
        },
      }),
      this.prisma.taxDocument.count({ where }),
    ])

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1,
      },
    }
  }

  async findOne(tenantId: string, id: string) {
    const doc = await this.prisma.taxDocument.findFirst({
      where: { id, tenantId },
      include: {
        sale: {
          // Las orders permiten derivar la "situación" del marketplace
          // (mediación, no entregada, etc.) en el modal de detalle.
          include: {
            orders: {
              select: { status: true, internalStatus: true, metadata: true },
            },
          },
        },
        order: true,
        lines: true,
        reference: true,
        creditNotes: true,
      },
    })
    if (!doc) throw new NotFoundException('Documento no encontrado')
    return doc
  }

  // ─── Emisión ──────────────────────────────────────────────────────────────

  async emitForSale(tenantId: string, saleId: string, dto: EmitTaxDocumentDto = {}) {
    const sale = await this.prisma.sale.findFirst({
      where: { id: saleId, tenantId },
      include: { orders: { include: { items: true } } },
    })
    if (!sale) throw new NotFoundException('Venta no encontrada')

    // Idempotencia: si ya hay un documento emitted/pending para esta venta, no
    // emitimos otro. La auto-emisión y la emisión manual usan este mismo
    // chequeo.
    const existing = await this.prisma.taxDocument.findFirst({
      where: {
        tenantId,
        saleId,
        status: { in: ['issued', 'pending'] },
        type: { in: ['boleta', 'factura'] },
      },
    })
    if (existing) {
      throw new BadRequestException(
        `La venta ya tiene un documento ${existing.status} (${existing.type}). Cancela el anterior antes de re-emitir.`,
      )
    }

    const type: 'boleta' | 'factura' = dto.type ?? this.decideDocumentType(sale)
    const lines = this.buildLines(sale)
    if (lines.length === 0) {
      throw new BadRequestException('La venta no tiene líneas para facturar')
    }
    const client = this.buildClient(sale, type)

    const references = this.buildReferences(sale)

    const { emitter, connection } = await this.resolveEmitter(tenantId)

    // Pre-validación: nunca queremos emitir documentos exentos. Si la
    // conexión no tiene taxIdIVA configurado, fallamos antes de crear un
    // draft (evita llenar la tabla de TaxDocument con `failed` ruidosos).
    const cfg = (connection.config || {}) as Record<string, unknown>
    if (!cfg.taxIdIVA) {
      throw new BadRequestException(
        'La conexión Bsale no tiene taxIdIVA configurado. Configúralo en /billing/setup antes de emitir.',
      )
    }

    const input: EmitDocumentInput = {
      type,
      emissionDate: new Date(),
      client,
      lines,
      references,
      currency: sale.currency,
    }

    // Creamos el TaxDocument en estado pending ANTES de llamar al emisor para
    // poder dejar la traza si la API externa falla.
    const draft = await this.prisma.taxDocument.create({
      data: {
        tenantId,
        saleId: sale.id,
        type,
        status: 'pending',
        emitter: connection.provider,
        snapshot: { client, lines, references, type } as any,
        attempts: 0,
      },
    })

    try {
      const result = await emitter.emitDocument(
        connection.credentials as Record<string, string>,
        connection.config as Record<string, unknown> | undefined,
        input,
      )

      // Persiste el resultado y crea las líneas con sus externalLineId
      // (necesarios para emitir NC totales más adelante).
      const updated = await this.prisma.taxDocument.update({
        where: { id: draft.id },
        data: {
          status: 'issued',
          externalId: result.externalId,
          folio: result.folio,
          emittedAt: result.emittedAt,
          pdfUrl: result.pdfUrl,
          xmlUrl: result.xmlUrl,
          attempts: 1,
          lines: {
            create: lines.map((l, i) => ({
              externalLineId: result.externalLineIds?.[i],
              sku: l.sku,
              name: l.name,
              quantity: l.quantity,
              netUnitValue: l.netUnitValue,
              taxIds: [],
              discount: l.discountPct ?? 0,
            })),
          },
        },
        include: { lines: true },
      })
      // Notificar al listener para que (si está habilitado) suba el DTE al
      // marketplace. El listener decide si encolar según config del tenant.
      try {
        await this.billing.onTaxDocumentIssued(tenantId, updated.id)
      } catch {
        // No bloquear la emisión si el listener falla.
      }
      return updated
    } catch (err: any) {
      await this.prisma.taxDocument.update({
        where: { id: draft.id },
        data: {
          status: 'failed',
          attempts: { increment: 1 },
          lastError: String(err?.message || err).slice(0, 500),
        },
      })
      throw new BadRequestException(`Emisión falló: ${err?.message || err}`)
    }
  }

  async retry(tenantId: string, id: string) {
    const doc = await this.findOne(tenantId, id)
    if (doc.status !== 'failed') {
      throw new BadRequestException('Solo se pueden reintentar documentos fallidos')
    }
    if (!doc.saleId) {
      throw new BadRequestException('El documento no está vinculado a una venta')
    }
    // Mantenemos el draft existente para no perder histórico de intentos.
    // Lo más simple: marcarlo cancelled y volver a emitir. Conservamos el log.
    await this.prisma.taxDocument.update({
      where: { id: doc.id },
      data: { status: 'cancelled', metadata: { retriedAs: 'new' } },
    })
    return this.emitForSale(tenantId, doc.saleId, { type: doc.type as 'boleta' | 'factura' })
  }

  async emitCreditNoteForSale(tenantId: string, saleId: string, dto: CreditNoteDto = {}) {
    const original = await this.prisma.taxDocument.findFirst({
      where: { tenantId, saleId, status: 'issued', type: { in: ['boleta', 'factura'] } },
      include: { lines: true },
      orderBy: { createdAt: 'desc' },
    })
    if (!original) {
      throw new NotFoundException(
        'No hay documento emitido para esta venta — no se puede crear nota de crédito',
      )
    }
    if (!original.externalId) {
      throw new BadRequestException('El documento original no tiene externalId del emisor')
    }

    // Idempotencia por documento original, no por sale. Una sale puede tener
    // ya una NC vieja sobre un doc previo (ej. NC sobre factura emitida por
    // bug del processor) y aun así necesitar otra NC sobre el doc vigente.
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
      throw new BadRequestException(
        `Ya existe una nota de crédito sobre el documento ${original.type} (folio ${original.folio || '-'})`,
      )
    }

    const { emitter, connection } = await this.resolveEmitter(tenantId, original.emitter)

    // NC siempre totales: revertimos todas las líneas del documento original.
    const linesToReturn = original.lines
      .filter((l: any) => l.externalLineId)
      .map((l: any) => ({
        externalLineId: l.externalLineId!,
        quantity: Number(l.quantity),
        netUnitValue: Number(l.netUnitValue),
      }))

    const draft = await this.prisma.taxDocument.create({
      data: {
        tenantId,
        saleId,
        type: 'nota_credito',
        status: 'pending',
        emitter: original.emitter,
        referenceDocumentId: original.id,
        attempts: 0,
      },
    })

    try {
      const result = await emitter.emitCreditNote(
        connection.credentials as Record<string, string>,
        connection.config as Record<string, unknown> | undefined,
        {
          originalExternalId: original.externalId,
          originalLines: linesToReturn,
          emissionDate: new Date(),
          motive: dto.motive || 'Cancelación de la orden marketplace',
        },
      )

      const updated = await this.prisma.taxDocument.update({
        where: { id: draft.id },
        data: {
          status: 'issued',
          externalId: result.externalId,
          folio: result.folio,
          emittedAt: result.emittedAt,
          pdfUrl: result.pdfUrl,
          xmlUrl: result.xmlUrl,
          attempts: 1,
        },
      })
      // Notificar al listener para que suba la NC al marketplace si está
      // habilitado (mismo flujo que para boletas/facturas).
      try {
        await this.billing.onTaxDocumentIssued(tenantId, updated.id)
      } catch {
        // ignoramos error del listener para no bloquear emisión
      }
      return updated
    } catch (err: any) {
      await this.prisma.taxDocument.update({
        where: { id: draft.id },
        data: {
          status: 'failed',
          attempts: { increment: 1 },
          lastError: String(err?.message || err).slice(0, 500),
        },
      })
      throw new BadRequestException(`NC falló: ${err?.message || err}`)
    }
  }

  // ─── Helpers internos ─────────────────────────────────────────────────────

  // Decide boleta vs factura. Solo factura cuando el marketplace marca
  // explícitamente `invoiceType='factura'` (ML detecta esto cuando vienen
  // BUSINESS_NAME / ECONOMIC_ACTIVITY; Paris vía businessInvoice). Si solo
  // viene billingDocNumber sin marca explícita, va boleta — los marketplaces
  // a veces traen el RUT informativo aunque el comprador no haya pedido
  // factura, y emitir factura sin que el cliente la pida nos obligaría a NC
  // posterior.
  private decideDocumentType(sale: any): 'boleta' | 'factura' {
    return sale.invoiceType === 'factura' ? 'factura' : 'boleta'
  }

  private buildLines(sale: any): TaxDocumentLineInput[] {
    const lines: TaxDocumentLineInput[] = []
    // Los marketplaces (ML, Falabella, Paris, Lider) entregan `unitPrice` como
    // precio BRUTO (incluye IVA). El consumidor paga ese monto y nosotros
    // queremos emitir el documento con ese mismo total. Bsale espera
    // `netUnitValue` (sin IVA) y agrega el impuesto encima — para que el
    // total final coincida con el precio del marketplace, dividimos por
    // 1.19 (IVA Chile 19%).
    //
    // En el futuro esto debería ser configurable por conexión: marketplaces
    // que ya entreguen precios netos no aplicarían la división.
    const IVA_RATE = 1.19
    for (const order of sale.orders || []) {
      for (const item of order.items || []) {
        const grossUnit = Number(item.unitPrice)
        const netUnit = grossUnit / IVA_RATE
        lines.push({
          sku: item.sku,
          name: item.name,
          quantity: Number(item.quantity),
          netUnitValue: netUnit,
        })
      }
    }
    return lines
  }

  private buildClient(sale: any, type: 'boleta' | 'factura'): TaxClientInput {
    // Bsale exige city + address + municipality para emitir factura. Tomamos
    // billingAddress primero (datos comerciales) y caemos a shippingAddress.
    // Los drivers entregan las direcciones como Json arbitrario; aceptamos
    // tanto las claves canónicas (address1/city/state) como las que algunos
    // marketplaces guardan (street, comuna, region).
    const addr = (sale.billingAddress || sale.shippingAddress || {}) as any
    const address: string | undefined =
      addr.address1 || addr.address || addr.street || undefined
    const city: string | undefined = addr.city || addr.locality || undefined
    const municipality: string | undefined =
      addr.municipality || addr.comuna || addr.district || addr.state || undefined

    if (type === 'factura') {
      const fullName: string = sale.billingName || sale.customerName || ''
      const [firstName, ...rest] = fullName.split(' ')
      return {
        rut: sale.billingDocNumber || sale.customerDocNumber,
        firstName: firstName || fullName || 'Cliente',
        lastName: rest.join(' '),
        email: sale.billingEmail || sale.customerEmail,
        phone: sale.billingPhone || sale.customerPhone,
        businessName: sale.billingName,
        economicActivity: sale.economicActivity,
        address,
        city: city || municipality,
        municipality: municipality || city,
        isCompany: true,
      }
    }
    // Boleta: priorizamos los datos del billing_info de ML por sobre los del
    // buyer. Razón: `/orders/search` de ML omite `buyer.identification` por
    // privacidad y solo se obtiene RUT confiable vía `/orders/{id}/billing_info`,
    // que el sync persiste en `billingDocNumber` / `billingName`. Si solo
    // miramos `customerDocNumber` todas las boletas caen al RUT genérico y
    // chocan al mismo cliente Bsale (síntoma: todas a nombre del primer
    // cliente creado en la cuenta).
    //
    // Fallback `66666666-6` solo si TODOS los campos están vacíos. Esto
    // permite emitir NC sobre boletas anónimas — el SII exige RUT
    // identificado en la NC aunque la boleta original no lo tenga.
    const fullName: string = sale.billingName || sale.customerName || 'Consumidor final'
    const [firstName, ...rest] = fullName.split(' ')
    return {
      rut: sale.billingDocNumber || sale.customerDocNumber || '66666666-6',
      firstName: firstName || fullName,
      lastName: rest.join(' '),
      email: sale.billingEmail || sale.customerEmail,
      phone: sale.billingPhone || sale.customerPhone,
      address,
      city: city || municipality,
      municipality: municipality || city,
    }
  }

  // Construye la lista de referencias del DTE. Estrategia:
  //   1) saleNumber (id estable interno) — primero, identificador maestro.
  //   2) Cada externalOrderId del marketplace — para reconciliación con ML/etc.
  // Todas con codeSii=801 ("orden de compra" en la tabla SII).
  // En packs (varias orders agrupadas) listamos todos los IDs de marketplace.
  private buildReferences(sale: any): Array<{ number: string; reason: string; codeSii: number }> {
    const refs: Array<{ number: string; reason: string; codeSii: number }> = []
    if (sale.saleNumber) {
      refs.push({
        number: String(sale.saleNumber),
        reason: 'Venta StockCentral',
        codeSii: 801,
      })
    }
    const sourceLabel = sale.source ? `Orden ${sale.source}` : 'Orden marketplace'
    for (const order of sale.orders || []) {
      if (order.externalOrderId) {
        refs.push({
          number: String(order.externalOrderId),
          reason: sourceLabel,
          codeSii: 801,
        })
      }
    }
    return refs
  }

  private async resolveEmitter(
    tenantId: string,
    preferProvider?: string,
  ): Promise<{ emitter: ITaxDocumentEmitter; connection: any }> {
    // Hoy solo soportamos bsale; multi-emisor real entra cuando se sume otro.
    const provider = preferProvider || 'bsale'
    const factory = EMITTERS[provider]
    if (!factory) {
      throw new BadRequestException(`Emisor "${provider}" no soportado`)
    }
    const connection = await this.prisma.connection.findFirst({
      where: { tenantId, provider },
    })
    if (!connection) {
      throw new BadRequestException(
        `Tenant no tiene conexión con el emisor "${provider}". Configúrala en /connections.`,
      )
    }
    return { emitter: factory(), connection }
  }

  // ─── Emisión bulk (manual desde UI) ──────────────────────────────────────
  // Encola un job EMIT_NOW por cada saleId con delay creciente para
  // throttle Bsale. Filtra de antemano:
  //   - sales que existen y pertenecen al tenant
  //   - sales sin doc issued/pending vigente
  // Devuelve el detalle de cuántos se encolaron y por qué se saltaron otros.
  async emitBulk(tenantId: string, dto: EmitBulkDto) {
    if (!dto.saleIds || dto.saleIds.length === 0) {
      throw new BadRequestException('saleIds vacío')
    }
    const sales = await this.prisma.sale.findMany({
      where: { id: { in: dto.saleIds }, tenantId },
      include: {
        taxDocuments: {
          where: { type: { in: ['boleta', 'factura'] }, status: { in: ['issued', 'pending'] } },
          select: { id: true, status: true },
        },
      },
    })

    const queued: string[] = []
    const skipped: Array<{ saleId: string; reason: string }> = []
    const notFound: string[] = []

    const foundIds = new Set(sales.map((s) => s.id))
    for (const id of dto.saleIds) {
      if (!foundIds.has(id)) notFound.push(id)
    }

    let delay = 0
    for (const sale of sales) {
      if (sale.taxDocuments.length > 0) {
        skipped.push({ saleId: sale.id, reason: 'ya tiene documento emitido o en proceso' })
        continue
      }
      await this.billing.enqueueEmitNow(tenantId, sale.id, dto.type, delay)
      queued.push(sale.id)
      delay += 1000 // 1s entre cada uno (throttle Bsale)
    }

    return {
      requested: dto.saleIds.length,
      queued: queued.length,
      skipped: skipped.length,
      notFound: notFound.length,
      details: { queued, skipped, notFound },
    }
  }

  // ─── Export CSV para reportes ────────────────────────────────────────────
  // Genera CSV con todos los TaxDocuments que matchen los filtros.
  // Sin paginación — usa los mismos filtros que findAll pero devuelve TODO.
  // Útil para preparar reportes mensuales/anuales en Excel/Sheets.
  async exportCsv(tenantId: string, query: TaxDocumentQueryDto): Promise<string> {
    const { search, status, type, emitter, saleId, orderId, placedFrom, placedTo } = query
    const where: any = { tenantId }
    if (status) where.status = status
    if (type) where.type = type
    if (emitter) where.emitter = emitter
    if (saleId) where.saleId = saleId
    if (orderId) where.orderId = orderId
    if (search) where.OR = this.buildSearchOr(search)
    if (placedFrom || placedTo) {
      const range: Record<string, Date> = {}
      if (placedFrom) range.gte = new Date(placedFrom)
      if (placedTo) {
        const to = new Date(placedTo)
        if (placedTo.length <= 10) to.setUTCHours(23, 59, 59, 999)
        range.lte = to
      }
      where.AND = [
        ...(where.AND || []),
        {
          sale: {
            is: {
              OR: [{ placedAt: range }, { AND: [{ placedAt: null }, { createdAt: range }] }],
            },
          },
        },
      ]
    }

    const docs = await this.prisma.taxDocument.findMany({
      where,
      orderBy: [
        { sale: { placedAt: { sort: 'desc', nulls: 'last' } } },
        { createdAt: 'desc' },
      ],
      include: {
        sale: {
          select: {
            saleNumber: true,
            customerName: true,
            customerDocNumber: true,
            billingName: true,
            billingDocNumber: true,
            total: true,
            currency: true,
            source: true,
            placedAt: true,
            createdAt: true,
            orders: { select: { externalOrderId: true }, take: 5 },
          },
        },
      },
    })

    const headers = [
      'Tipo',
      'Folio',
      'Estado',
      'Emisor',
      'Venta',
      'Marketplace',
      'Order ID externo',
      'Fecha venta',
      'Fecha emisión',
      'Cliente',
      'RUT cliente',
      'Razón social',
      'RUT facturación',
      'Total',
      'Moneda',
      'PDF',
      'XML',
    ]
    const rows: string[][] = [headers]
    for (const d of docs) {
      const sale = d.sale as any
      const fechaVenta = sale?.placedAt || sale?.createdAt
      const orderIds = (sale?.orders || []).map((o: any) => o.externalOrderId).filter(Boolean).join('; ')
      rows.push([
        d.type,
        d.folio || '',
        d.status,
        d.emitter,
        sale?.saleNumber || '',
        sale?.source || '',
        orderIds,
        fechaVenta ? new Date(fechaVenta).toISOString() : '',
        d.emittedAt ? d.emittedAt.toISOString() : '',
        sale?.customerName || '',
        sale?.customerDocNumber || '',
        sale?.billingName || '',
        sale?.billingDocNumber || '',
        sale?.total?.toString() || '',
        sale?.currency || '',
        d.pdfUrl || '',
        d.xmlUrl || '',
      ])
    }
    return rows.map((r) => r.map(csvEscape).join(',')).join('\n')
  }

  // ─── Marcar cargada por otro medio (sin tocar Bsale) ─────────────────────
  // Crea un TaxDocument local con emitter='ml-external' para que la venta
  // deje de aparecer en "Por facturar" y muestre el badge "Cargado por otro
  // medio". NO interactúa con Bsale ni con el marketplace. Idempotente: si
  // la sale ya tiene doc issued/pending, salta.
  async markExternal(tenantId: string, dto: MarkExternalDto) {
    const sales = await this.prisma.sale.findMany({
      where: { id: { in: dto.saleIds }, tenantId },
      include: {
        taxDocuments: {
          where: { type: { in: ['boleta', 'factura'] }, status: { in: ['issued', 'pending'] } },
          select: { id: true },
        },
      },
    })

    const marked: string[] = []
    const skipped: Array<{ saleId: string; reason: string }> = []
    const notFound: string[] = []
    const foundIds = new Set(sales.map((s) => s.id))
    for (const id of dto.saleIds) if (!foundIds.has(id)) notFound.push(id)

    for (const sale of sales) {
      if (sale.taxDocuments.length > 0) {
        skipped.push({ saleId: sale.id, reason: 'ya tiene documento' })
        continue
      }
      const type = sale.invoiceType === 'factura' ? 'factura' : 'boleta'
      await this.prisma.taxDocument.create({
        data: {
          tenantId,
          saleId: sale.id,
          type,
          status: 'issued',
          emitter: 'ml-external',
          emittedAt: new Date(),
          attempts: 1,
          metadata: { source: 'manual-mark', markedAt: new Date().toISOString() } as any,
        },
      })
      marked.push(sale.id)
    }

    return {
      requested: dto.saleIds.length,
      marked: marked.length,
      skipped: skipped.length,
      notFound: notFound.length,
      details: { marked, skipped, notFound },
    }
  }

  // ─── Push manual al marketplace ──────────────────────────────────────────
  // Fuerza el upload del DTE al marketplace ignorando el flag pushToMarketplace
  // (porque el operador ya decidió subirlo al apretar el botón). Usado para:
  // - Documentos emitidos antes de activar pushToMarketplace.
  // - Documentos que fallaron el upload automático y se quieren reintentar.
  async pushToMarketplaceManual(tenantId: string, id: string) {
    const doc = await this.prisma.taxDocument.findFirst({
      where: { id, tenantId },
    })
    if (!doc) throw new NotFoundException('Documento no encontrado')
    if (doc.status !== 'issued') {
      throw new BadRequestException(`El documento debe estar issued (actual: ${doc.status})`)
    }
    if (!doc.pdfUrl) {
      throw new BadRequestException('El documento no tiene pdfUrl')
    }
    // Llamamos al listener directamente. El listener verifica el flag pero
    // como ya está activado (o no, el operador decidió manualmente), agregamos
    // bypass: encolamos el job directo.
    await this.billing.enqueuePushToMarketplace(tenantId, id)
    return { ok: true, message: 'Push encolado' }
  }

  // ─── Conversión boleta → factura ─────────────────────────────────────────
  // Caso: el cliente pide factura después de emitida la boleta. Flujo: NC
  // sobre la boleta + emisión de factura. Idempotente: si la sale ya tiene
  // factura issued, no hace nada. Si la NC ya existe, salta a emisión.
  async convertBoletaToFactura(tenantId: string, saleId: string) {
    const sale = await this.prisma.sale.findFirst({ where: { id: saleId, tenantId } })
    if (!sale) throw new NotFoundException('Venta no encontrada')
    if (!sale.billingDocNumber || !sale.billingName) {
      throw new BadRequestException(
        'La venta no tiene datos de facturación (billingDocNumber + billingName) — no se puede emitir factura',
      )
    }

    const boleta = await this.prisma.taxDocument.findFirst({
      where: { tenantId, saleId, type: 'boleta', status: 'issued' },
    })
    if (!boleta) {
      throw new BadRequestException('No hay boleta emitida para esta venta')
    }

    const existingFactura = await this.prisma.taxDocument.findFirst({
      where: { tenantId, saleId, type: 'factura', status: { in: ['issued', 'pending'] } },
    })
    if (existingFactura) {
      return { ncId: null, factura: existingFactura, alreadyConverted: true }
    }

    // 1) Anular la boleta con NC (si todavía no existe).
    const existingNc = await this.prisma.taxDocument.findFirst({
      where: {
        tenantId,
        saleId,
        type: 'nota_credito',
        referenceDocumentId: boleta.id,
        status: { in: ['issued', 'pending'] },
      },
    })
    const nc =
      existingNc ||
      (await this.emitCreditNoteForSale(tenantId, saleId, {
        motive: 'Conversión a factura',
      }))

    // 2) Emitir factura nueva.
    const factura = await this.emitForSale(tenantId, saleId, { type: 'factura' })

    return { nc, factura, alreadyConverted: false }
  }

  // ─── Test de conexión ─────────────────────────────────────────────────────

  async testEmitterConnection(tenantId: string, provider = 'bsale') {
    const factory = EMITTERS[provider]
    if (!factory) throw new BadRequestException(`Emisor "${provider}" no soportado`)
    const connection = await this.prisma.connection.findFirst({
      where: { tenantId, provider },
    })
    if (!connection) {
      throw new NotFoundException(`No hay conexión "${provider}" para este tenant`)
    }
    const emitter = factory()
    return emitter.testConnection(
      connection.credentials as Record<string, string>,
      connection.config as Record<string, unknown> | undefined,
    )
  }

  // ─── Upload manual de PDF ─────────────────────────────────────────────────

  async uploadManualDocument(
    tenantId: string,
    dto: UploadManualDocumentDto,
    file: Express.Multer.File,
  ) {
    if (!file?.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Archivo vacío')
    }
    if (file.mimetype !== 'application/pdf') {
      throw new BadRequestException('Solo se aceptan archivos PDF')
    }
    const sale = await this.prisma.sale.findFirst({
      where: { id: dto.saleId, tenantId },
    })
    if (!sale) throw new NotFoundException('Venta no encontrada')

    // Idempotencia + persistencia: hash del PDF como filename. Reutiliza si ya existe.
    const hash = crypto.createHash('sha256').update(file.buffer).digest('hex')
    const filename = `${hash}.pdf`
    const dest = path.join(this.uploadsRoot, filename)
    if (!fs.existsSync(dest)) fs.writeFileSync(dest, file.buffer)
    const pdfUrl = `${this.mediaBaseUrl}/tax-documents/${filename}`

    const emittedAt = dto.emittedAt ? new Date(dto.emittedAt) : new Date()

    return this.prisma.taxDocument.create({
      data: {
        tenantId,
        saleId: dto.saleId,
        type: dto.type,
        status: 'issued',
        emitter: 'manual',
        folio: dto.folio,
        emittedAt,
        pdfUrl,
        attempts: 1,
        snapshot: { uploadedManually: true, originalFilename: file.originalname } as any,
      },
    })
  }

  // Resuelve el path en disco de un PDF subido manualmente. Lo usa el
  // controller para servir el archivo con sendFile.
  getUploadedPdfPath(filename: string): string {
    // Sanity: no permitimos path traversal.
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      throw new BadRequestException('Filename inválido')
    }
    const filePath = path.join(this.uploadsRoot, filename)
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('PDF no encontrado')
    }
    return filePath
  }
}
