import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { getDriver } from '@stockcentral/integrations'
import { CreateOfferDto, UpdateOfferDto, ListOffersQueryDto } from './dto/offer.dto'

// Service de ofertas marketplace. Fuente de verdad local — StockCentral
// configura la oferta y el orquestador (OffersScheduler) la empuja al
// marketplace cuando llega startDate y la limpia cuando expira.
//
// Regla: descuento por porcentaje sobre `Product.marketplacePricing[provider]
// .calculatedPrice`. El `calculatedSalePrice` se recalcula cada vez que se
// activa o cuando el calculatedPrice base cambia (drift detection).
@Injectable()
export class OffersService {
  private readonly logger = new Logger(OffersService.name)

  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, query: ListOffersQueryDto) {
    const where: any = { tenantId }
    if (query.status) where.status = query.status
    if (query.productId) where.productId = query.productId
    if (query.connectionId) where.connectionId = query.connectionId
    return this.prisma.marketplaceOffer.findMany({
      where,
      orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
      include: {
        product: { select: { id: true, sku: true, name: true, marketplacePricing: true, basePrice: true } },
        connection: { select: { id: true, provider: true, name: true } },
      },
    })
  }

  async findOne(tenantId: string, id: string) {
    const offer = await this.prisma.marketplaceOffer.findFirst({
      where: { id, tenantId },
      include: {
        product: { select: { id: true, sku: true, name: true, marketplacePricing: true, basePrice: true } },
        connection: { select: { id: true, provider: true, name: true } },
      },
    })
    if (!offer) throw new NotFoundException('Oferta no encontrada')
    return offer
  }

  async create(tenantId: string, dto: CreateOfferDto) {
    let product = await this.prisma.product.findFirst({
      where: { id: dto.productId, tenantId },
    })
    if (!product) throw new NotFoundException('Producto no encontrado')

    const connection = await this.prisma.connection.findFirst({
      where: { id: dto.connectionId, tenantId },
    })
    if (!connection) throw new NotFoundException('Conexión no encontrada')

    const startDate = new Date(dto.startDate)
    const endDate = new Date(dto.endDate)
    if (endDate <= startDate) {
      throw new BadRequestException('endDate debe ser posterior a startDate')
    }

    // Si el operador editó el precio normal desde el modal, lo sobreescribimos
    // ANTES de derivar el descuento y antes de validar overlaps.
    if (dto.overrideCalculatedPrice !== undefined) {
      const pricing = ((product.marketplacePricing as any) || {}) as Record<string, any>
      const existing = pricing[connection.provider] || {}
      const updated = await this.prisma.product.update({
        where: { id: product.id },
        data: {
          marketplacePricing: {
            ...pricing,
            [connection.provider]: {
              ...existing,
              calculatedPrice: Math.round(dto.overrideCalculatedPrice),
              manualOverride: true,
              manualOverrideAt: new Date().toISOString(),
            },
          } as any,
        },
      })
      product = updated
      this.logger.log(
        `Producto ${product.sku}: calculatedPrice[${connection.provider}] sobreescrito a ${dto.overrideCalculatedPrice} desde modal de oferta`,
      )
    }

    // Resolver el descuento: porcentaje O precio fijo, exactamente uno.
    const { discountPct, calculatedSalePrice } = this.resolveDiscount(product, connection.provider, dto)

    // Validar overlap con ofertas activas/scheduled del mismo producto+conexión.
    const overlap = await this.prisma.marketplaceOffer.findFirst({
      where: {
        tenantId,
        productId: dto.productId,
        connectionId: dto.connectionId,
        status: { in: ['scheduled', 'active'] },
        AND: [
          { startDate: { lte: endDate } },
          { endDate: { gte: startDate } },
        ],
      },
    })
    if (overlap) {
      throw new BadRequestException(
        `Conflicto de fechas con la oferta existente ${overlap.id} (${overlap.startDate.toISOString().slice(0, 10)} → ${overlap.endDate.toISOString().slice(0, 10)})`,
      )
    }

    // Status inicial: 'scheduled' siempre. El scheduler la pasará a 'active'
    // en el siguiente tick si startDate <= now().
    const created = await this.prisma.marketplaceOffer.create({
      data: {
        tenantId,
        productId: dto.productId,
        connectionId: dto.connectionId,
        discountPct,
        startDate,
        endDate,
        status: 'scheduled',
        syncStatus: 'pending',
        source: 'local',
        notes: dto.notes,
        // Pre-llenamos calculatedSalePrice para que la UI ya muestre el monto;
        // el scheduler lo va a recalcular al activar igualmente.
        calculatedSalePrice: calculatedSalePrice ?? undefined,
      },
    })

    // Si se sobreescribió calculatedPrice y hay otras ofertas active del
    // mismo producto+conexión, marcarlas como pending para que el scheduler
    // las re-pushee con el nuevo precio base. Sin esto, sus calculatedSalePrice
    // quedarían desfasados del nuevo basePrice.
    if (dto.overrideCalculatedPrice !== undefined) {
      const affected = await this.prisma.marketplaceOffer.updateMany({
        where: {
          tenantId,
          productId: dto.productId,
          connectionId: dto.connectionId,
          status: 'active',
          id: { not: created.id },
        },
        data: { syncStatus: 'pending' },
      })
      if (affected.count > 0) {
        this.logger.log(
          `${affected.count} oferta(s) activa(s) del mismo producto marcadas para resync por cambio de calculatedPrice`,
        )
      }
    }

    return created
  }

  // Resuelve discountPct + calculatedSalePrice a partir de los inputs del
  // operador. Acepta porcentaje O precio fijo, exactamente uno.
  // - discountPct: aplica el % al calculatedPrice del producto.
  // - fixedSalePrice: deriva el % equivalente para persistirlo (la regla
  //   sigue siendo 'porcentaje sobre precio normal', el precio fijo es solo
  //   una conveniencia de input).
  private resolveDiscount(
    product: any,
    provider: string,
    dto: CreateOfferDto,
  ): { discountPct: number; calculatedSalePrice: number | null } {
    const hasPct = dto.discountPct !== undefined && dto.discountPct !== null
    const hasFixed = dto.fixedSalePrice !== undefined && dto.fixedSalePrice !== null
    if (hasPct === hasFixed) {
      throw new BadRequestException(
        'Pasa exactamente uno: discountPct o fixedSalePrice (no ambos, no ninguno).',
      )
    }

    const pricing = (product?.marketplacePricing || {}) as Record<string, any>
    const provPricing = pricing[provider]
    const basePrice =
      provPricing?.calculatedPrice ? Number(provPricing.calculatedPrice) :
      product?.basePrice ? Number(product.basePrice) : null

    if (hasPct) {
      const pct = Number(dto.discountPct)
      const sale = basePrice ? Math.round(basePrice * (1 - pct / 100)) : null
      return { discountPct: pct, calculatedSalePrice: sale }
    }

    // hasFixed
    const fixed = Number(dto.fixedSalePrice)
    if (!basePrice || basePrice <= 0) {
      throw new BadRequestException(
        'No se puede usar fixedSalePrice sin un precio base configurado en marketplacePricing o basePrice.',
      )
    }
    if (fixed >= basePrice) {
      throw new BadRequestException(
        `fixedSalePrice (${fixed}) debe ser menor al precio base (${basePrice}).`,
      )
    }
    const pct = Math.round(((basePrice - fixed) / basePrice) * 100 * 100) / 100
    return { discountPct: pct, calculatedSalePrice: fixed }
  }

  async update(tenantId: string, id: string, dto: UpdateOfferDto) {
    const offer = await this.findOne(tenantId, id)
    if (offer.status === 'expired' || offer.status === 'cancelled') {
      throw new BadRequestException(
        `No se puede editar una oferta en estado ${offer.status}. Cancela y crea una nueva.`,
      )
    }
    const data: any = {}
    if (dto.discountPct !== undefined) data.discountPct = dto.discountPct
    if (dto.startDate) data.startDate = new Date(dto.startDate)
    if (dto.endDate) data.endDate = new Date(dto.endDate)
    if (dto.notes !== undefined) data.notes = dto.notes
    // Si se modifica precio/fechas y la oferta está activa, marcar pending
    // para que el scheduler la re-pushee con los nuevos valores.
    if ((dto.discountPct !== undefined || dto.startDate || dto.endDate) && offer.status === 'active') {
      data.syncStatus = 'pending'
    }
    return this.prisma.marketplaceOffer.update({ where: { id }, data })
  }

  async cancel(tenantId: string, id: string) {
    const offer = await this.findOne(tenantId, id)
    if (offer.status === 'expired' || offer.status === 'cancelled') {
      throw new BadRequestException(`La oferta ya está ${offer.status}`)
    }
    // Si está activa, limpiar en marketplace antes de marcar cancelled.
    if (offer.status === 'active') {
      try {
        await this.clearOfferInMarketplace(offer)
      } catch (err: any) {
        this.logger.warn(`Error limpiando oferta ${id} en marketplace: ${err?.message}`)
      }
    }
    return this.prisma.marketplaceOffer.update({
      where: { id },
      data: { status: 'cancelled', syncedAt: new Date() },
    })
  }

  // ─── Sync con marketplace ─────────────────────────────────────────────────

  // Activa una oferta scheduled: calcula salePrice, persiste snapshot,
  // empuja a marketplace y marca como 'active'.
  async activateAndPush(offerId: string) {
    const offer = await this.prisma.marketplaceOffer.findUnique({
      where: { id: offerId },
      include: {
        product: { select: { id: true, sku: true, name: true, marketplacePricing: true, basePrice: true } },
        connection: true,
      },
    })
    if (!offer) throw new NotFoundException(`Oferta ${offerId} no existe`)

    const { calculatedSalePrice, basePrice } = this.computeSalePrice(offer)
    if (!calculatedSalePrice) {
      throw new BadRequestException(
        `No se puede calcular el precio oferta: el producto no tiene marketplacePricing[${offer.connection.provider}].calculatedPrice ni basePrice válido`,
      )
    }

    try {
      await this.pushOfferToMarketplace(offer, calculatedSalePrice)
      await this.prisma.marketplaceOffer.update({
        where: { id: offerId },
        data: {
          status: 'active',
          calculatedSalePrice,
          basePriceAtActivation: basePrice,
          syncStatus: 'success',
          syncedAt: new Date(),
          syncError: null,
        },
      })
      this.logger.log(`Oferta ${offerId} activada y pusheada (salePrice=${calculatedSalePrice}, ${offer.connection.provider})`)
    } catch (err: any) {
      await this.prisma.marketplaceOffer.update({
        where: { id: offerId },
        data: {
          syncStatus: 'failed',
          syncedAt: new Date(),
          syncError: String(err?.message || err).slice(0, 500),
        },
      })
      throw err
    }
  }

  // Limpia una oferta activa: empuja a marketplace con SalePriceFalabella
  // vacío + SaleEndDate al pasado, y marca como 'expired'.
  async expireAndClear(offerId: string) {
    const offer = await this.prisma.marketplaceOffer.findUnique({
      where: { id: offerId },
      include: {
        product: { select: { id: true, sku: true, name: true } },
        connection: true,
      },
    })
    if (!offer) throw new NotFoundException(`Oferta ${offerId} no existe`)
    try {
      await this.clearOfferInMarketplace(offer)
      await this.prisma.marketplaceOffer.update({
        where: { id: offerId },
        data: { status: 'expired', syncStatus: 'success', syncedAt: new Date(), syncError: null },
      })
      this.logger.log(`Oferta ${offerId} expirada y limpiada en ${offer.connection.provider}`)
    } catch (err: any) {
      await this.prisma.marketplaceOffer.update({
        where: { id: offerId },
        data: {
          syncStatus: 'failed',
          syncedAt: new Date(),
          syncError: String(err?.message || err).slice(0, 500),
        },
      })
      throw err
    }
  }

  // Re-pushea una oferta activa cuyo calculatedPrice base cambió.
  async resyncActive(offerId: string) {
    const offer = await this.prisma.marketplaceOffer.findUnique({
      where: { id: offerId },
      include: {
        product: { select: { id: true, sku: true, name: true, marketplacePricing: true, basePrice: true } },
        connection: true,
      },
    })
    if (!offer || offer.status !== 'active') return
    const { calculatedSalePrice } = this.computeSalePrice(offer)
    if (!calculatedSalePrice) return
    // Si el precio no cambió, no hacer push.
    if (offer.calculatedSalePrice && Number(offer.calculatedSalePrice) === calculatedSalePrice) {
      return
    }
    try {
      await this.pushOfferToMarketplace(offer, calculatedSalePrice)
      await this.prisma.marketplaceOffer.update({
        where: { id: offerId },
        data: {
          calculatedSalePrice,
          syncStatus: 'success',
          syncedAt: new Date(),
          syncError: null,
        },
      })
      this.logger.log(`Oferta ${offerId} re-sincronizada por drift (nuevo salePrice=${calculatedSalePrice})`)
    } catch (err: any) {
      await this.prisma.marketplaceOffer.update({
        where: { id: offerId },
        data: {
          syncStatus: 'failed',
          syncedAt: new Date(),
          syncError: String(err?.message || err).slice(0, 500),
        },
      })
      throw err
    }
  }

  // ─── Detección de ofertas externas ────────────────────────────────────────

  // Escanea todos los productos vinculados a una conexión, lee el estado en
  // el marketplace y crea registros `source: 'detected_external'` cuando
  // encuentra una oferta vigente en el marketplace que no tiene una oferta
  // local correspondiente. Útil cuando alguien crea ofertas desde
  // Sellercenter directamente y queremos visibilidad.
  async scanExternalOffers(tenantId: string, connectionId: string) {
    const connection = await this.prisma.connection.findFirst({
      where: { id: connectionId, tenantId },
    })
    if (!connection) throw new NotFoundException('Conexión no encontrada')
    if (connection.provider !== 'falabella') {
      // Hoy solo Falabella expone ofertas en su API. ML/Paris/Lider se ignoran.
      return { ok: false, reason: 'provider_not_supported', provider: connection.provider }
    }
    const driver = getDriver(connection.provider)
    if (!driver.getProduct) {
      return { ok: false, reason: 'driver_no_get_product' }
    }
    const credentials = connection.credentials as Record<string, string>
    const config = connection.config as Record<string, unknown> | undefined

    // Recorremos solo productos que tengan mapping en esta conexión.
    const mappings = await this.prisma.marketplaceMapping.findMany({
      where: { connectionId, marketplaceProductId: { not: null } },
      include: { product: { select: { id: true, sku: true, name: true, basePrice: true } } },
    })

    let detected = 0
    let alreadyTracked = 0
    let noOffer = 0
    let errors = 0
    const newOffers: string[] = []

    for (const mapping of mappings) {
      try {
        const marketProduct = await driver.getProduct(credentials, mapping.marketplaceProductId!, config)
        const raw = (marketProduct as any)?.rawData || {}
        const pd = raw.ProductData || {}
        const salePrice = pd.SalePriceFalabella ? Number(pd.SalePriceFalabella) : null
        const saleStart = pd.SaleStartDateFalabella as string | undefined
        const saleEnd = pd.SaleEndDateFalabella as string | undefined
        if (!salePrice || !saleStart || !saleEnd) { noOffer++; continue }

        const startDate = new Date(saleStart.replace(' ', 'T') + 'Z')
        const endDate = new Date(saleEnd.replace(' ', 'T') + 'Z')
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
          this.logger.warn(`Fechas inválidas para ${mapping.product.sku}: ${saleStart} → ${saleEnd}`)
          errors++; continue
        }
        // Si el rango ya pasó, no es oferta activa.
        if (endDate < new Date()) { noOffer++; continue }

        // Buscamos si ya existe oferta local que cubra este rango.
        const existing = await this.prisma.marketplaceOffer.findFirst({
          where: {
            tenantId,
            productId: mapping.productId,
            connectionId,
            status: { in: ['scheduled', 'active'] },
            startDate: { lte: endDate },
            endDate: { gte: startDate },
          },
        })
        if (existing) { alreadyTracked++; continue }

        // Calculamos descuento aproximado. Falabella expone Price en BU.
        const buData = raw.BusinessUnits?.BusinessUnit
        const firstBu = Array.isArray(buData) ? buData[0] : buData
        const basePrice = firstBu?.Price ? Number(firstBu.Price) : Number(mapping.product.basePrice)
        const discountPct = basePrice > 0
          ? Math.round(((basePrice - salePrice) / basePrice) * 100 * 100) / 100
          : 0

        const created = await this.prisma.marketplaceOffer.create({
          data: {
            tenantId,
            productId: mapping.productId,
            connectionId,
            discountPct,
            startDate,
            endDate,
            status: endDate > new Date() && startDate <= new Date() ? 'active' : 'scheduled',
            calculatedSalePrice: salePrice,
            basePriceAtActivation: basePrice,
            syncStatus: 'success',
            syncedAt: new Date(),
            source: 'detected_external',
            notes: `Detectada en ${connection.provider} sin origen local`,
          },
        })
        detected++
        newOffers.push(created.id)
        this.logger.log(`Oferta externa detectada: ${mapping.product.sku} -${discountPct}% → ${salePrice}`)
      } catch (err: any) {
        this.logger.error(`Scan externo ${mapping.product.sku} falló: ${err?.message}`)
        errors++
      }
    }

    return { ok: true, scanned: mappings.length, detected, alreadyTracked, noOffer, errors, newOfferIds: newOffers }
  }

  // ─── Helpers internos ─────────────────────────────────────────────────────

  // Calcula el precio oferta: `calculatedPrice * (100 - discountPct) / 100`.
  // Si el producto no tiene calculatedPrice para el provider, cae a basePrice.
  // Devuelve también el basePrice usado (para guardar snapshot).
  private computeSalePrice(offer: any): { calculatedSalePrice: number | null; basePrice: number | null } {
    const pricing = (offer.product?.marketplacePricing || {}) as Record<string, any>
    const provPricing = pricing[offer.connection.provider]
    const basePrice =
      provPricing?.calculatedPrice ? Number(provPricing.calculatedPrice) :
      offer.product?.basePrice ? Number(offer.product.basePrice) : null
    if (!basePrice || basePrice <= 0) return { calculatedSalePrice: null, basePrice: null }
    const discount = Number(offer.discountPct) / 100
    const salePrice = Math.round(basePrice * (1 - discount))
    return { calculatedSalePrice: salePrice, basePrice }
  }

  private async pushOfferToMarketplace(offer: any, salePrice: number) {
    const driver = getDriver(offer.connection.provider)
    if (!driver.updateProduct) {
      throw new Error(`Driver ${offer.connection.provider} no soporta updateProduct`)
    }
    const mapping = await this.prisma.marketplaceMapping.findFirst({
      where: { productId: offer.productId, connectionId: offer.connectionId },
    })
    if (!mapping?.marketplaceProductId) {
      throw new Error(`Producto no publicado en ${offer.connection.provider} — sin marketplaceProductId`)
    }

    // Formato de fechas que Falabella espera ('YYYY-MM-DD HH:MM:SS').
    const fmt = (d: Date) =>
      `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)}`
    const credentials = offer.connection.credentials as Record<string, string>
    const config = offer.connection.config as Record<string, unknown> | undefined

    // Para Falabella usamos el campo formData.SalePriceFalabella. Otros
    // marketplaces extenderían el driver con su propio shape.
    const formData: Record<string, unknown> = {
      SalePriceFalabella: salePrice,
      SaleStartDateFalabella: fmt(offer.startDate),
      SaleEndDateFalabella: fmt(offer.endDate),
    }

    // No mandamos price (mantener el normal intacto). No mandamos stock.
    const result = await driver.updateProduct(
      credentials,
      mapping.marketplaceProductId,
      { sku: offer.product.sku, formData } as any,
      config,
    )
    if (!result.success) {
      throw new Error(result.error || 'updateProduct falló sin mensaje')
    }
  }

  private async clearOfferInMarketplace(offer: any) {
    const driver = getDriver(offer.connection.provider)
    if (!driver.updateProduct) return
    const mapping = await this.prisma.marketplaceMapping.findFirst({
      where: { productId: offer.productId, connectionId: offer.connectionId },
    })
    if (!mapping?.marketplaceProductId) return
    const credentials = offer.connection.credentials as Record<string, string>
    const config = offer.connection.config as Record<string, unknown> | undefined
    // Estrategia: mandar SaleEndDateFalabella al día anterior. Falabella
    // interpreta la oferta como expirada y deja de mostrar el SalePrice.
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000)
    const fmt = (d: Date) =>
      `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)}`
    const formData: Record<string, unknown> = {
      SalePriceFalabella: 0,
      SaleStartDateFalabella: fmt(yesterday),
      SaleEndDateFalabella: fmt(yesterday),
    }
    await driver.updateProduct(
      credentials,
      mapping.marketplaceProductId,
      { sku: offer.product.sku, formData } as any,
      config,
    )
  }
}
