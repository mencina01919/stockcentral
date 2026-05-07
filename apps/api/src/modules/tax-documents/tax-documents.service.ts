import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
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
import {
  TaxDocumentQueryDto,
  EmitTaxDocumentDto,
  CreditNoteDto,
  UploadManualDocumentDto,
} from './dto/tax-document.dto'

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
  ) {
    this.uploadsRoot = path.join(process.cwd(), 'uploads', 'tax-documents')
    if (!fs.existsSync(this.uploadsRoot)) fs.mkdirSync(this.uploadsRoot, { recursive: true })

    const explicit = this.config.get<string>('MEDIA_BASE_URL')
    const apiUrl = this.config.get<string>('APP_URL', 'http://localhost:3001')
    this.mediaBaseUrl = (explicit || apiUrl).replace(/\/$/, '')
  }

  // ─── Listado / lectura ────────────────────────────────────────────────────

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
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query
    const skip = (page - 1) * limit
    const where: any = { tenantId }
    if (status) where.status = status
    if (type) where.type = type
    if (emitter) where.emitter = emitter
    if (saleId) where.saleId = saleId
    if (orderId) where.orderId = orderId
    if (search) {
      where.OR = [
        { folio: { contains: search, mode: 'insensitive' } },
        { externalId: { contains: search, mode: 'insensitive' } },
      ]
    }

    const [data, total] = await Promise.all([
      this.prisma.taxDocument.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          sale: { select: { id: true, saleNumber: true, customerName: true, total: true } },
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
        sale: true,
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

    const externalReference = this.buildExternalReference(sale)

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
      externalReference,
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
        snapshot: { client, lines, externalReference, type } as any,
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

    const existingNc = await this.prisma.taxDocument.findFirst({
      where: { tenantId, saleId, type: 'nota_credito', status: { in: ['issued', 'pending'] } },
    })
    if (existingNc) {
      throw new BadRequestException('Ya existe una nota de crédito para esta venta')
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

      return await this.prisma.taxDocument.update({
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

  // Decide boleta vs factura en base a los datos de billing capturados por los
  // drivers de marketplace. Si hay RUT + razón social → factura. Si no → boleta.
  private decideDocumentType(sale: any): 'boleta' | 'factura' {
    const hasFacturaData =
      sale.billingDocNumber && (sale.billingName || sale.invoiceType === 'factura')
    return hasFacturaData ? 'factura' : 'boleta'
  }

  private buildLines(sale: any): TaxDocumentLineInput[] {
    const lines: TaxDocumentLineInput[] = []
    for (const order of sale.orders || []) {
      for (const item of order.items || []) {
        lines.push({
          sku: item.sku,
          name: item.name,
          quantity: Number(item.quantity),
          netUnitValue: Number(item.unitPrice),
        })
      }
    }
    return lines
  }

  private buildClient(sale: any, type: 'boleta' | 'factura'): TaxClientInput {
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
        isCompany: true,
      }
    }
    // Boleta: si no hay nombre ni RUT, va como consumidor final.
    const fullName: string = sale.customerName || 'Consumidor final'
    const [firstName, ...rest] = fullName.split(' ')
    return {
      rut: sale.customerDocNumber || undefined,
      firstName: firstName || fullName,
      lastName: rest.join(' '),
      email: sale.customerEmail,
      phone: sale.customerPhone,
    }
  }

  // El número de orden externo del marketplace va como "orden de compra" en el
  // documento. Si la sale tiene varias orders (pack), tomamos la primera con
  // externalOrderId; en el caso multi-orden esto puede mejorarse luego para
  // listar todas las referencias.
  private buildExternalReference(sale: any): { number: string; reason?: string } | undefined {
    for (const order of sale.orders || []) {
      if (order.externalOrderId) {
        return {
          number: order.externalOrderId,
          reason: `Orden ${sale.source}`,
        }
      }
    }
    return undefined
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
