import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { CreateProductDto, UpdateProductDto, ProductQueryDto } from './dto/product.dto'
import { getDriver, ParisDriver } from '@stockcentral/integrations'

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  private async generateSku(tenantId: string, name: string): Promise<string> {
    const base = name
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 3)
      .map((w) => w.slice(0, 4))
      .join('-')

    let candidate = base
    let suffix = 1
    while (await this.prisma.product.findUnique({ where: { tenantId_sku: { tenantId, sku: candidate } } })) {
      candidate = `${base}-${suffix++}`
    }
    return candidate
  }

  private computeMargin(basePrice: number, costPrice?: number): number | null {
    if (!costPrice || costPrice === 0 || basePrice === 0) return null
    return Math.round(((basePrice - costPrice) / basePrice) * 10000) / 100
  }

  async findAll(tenantId: string, query: ProductQueryDto & { connectionId?: string }) {
    const { page = 1, limit = 20, search, status, brand, connectionId, sortBy = 'createdAt', sortOrder = 'desc' } = query
    const skip = (page - 1) * limit

    const where: any = { tenantId }
    if (status) where.status = status
    if (brand) where.brand = { contains: brand, mode: 'insensitive' }
    if (connectionId) where.marketplaceMappings = { some: { connectionId } }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { brand: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ]
    }

    const [data, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          variants: true,
          inventory: {
            include: { warehouse: { select: { name: true } } },
          },
          _count: { select: { marketplaceMappings: true } },
        },
      }),
      this.prisma.product.count({ where }),
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
    const product = await this.prisma.product.findFirst({
      where: { id, tenantId },
      include: {
        variants: true,
        inventory: { include: { warehouse: true } },
        marketplaceMappings: { include: { connection: true } },
      },
    })
    if (!product) throw new NotFoundException('Producto no encontrado')
    return product
  }

  async create(tenantId: string, dto: CreateProductDto) {
    const sku = dto.sku?.trim() || (await this.generateSku(tenantId, dto.name))

    const existing = await this.prisma.product.findUnique({
      where: { tenantId_sku: { tenantId, sku } },
    })
    if (existing) throw new ConflictException(`El SKU "${sku}" ya existe`)

    const { stockOnline, stockWarehouse, stockStore, ...productFields } = dto

    const margin = productFields.targetMargin !== undefined
      ? productFields.targetMargin
      : (this.computeMargin(productFields.basePrice, productFields.costPrice) ?? undefined)

    const product = await this.prisma.product.create({
      data: { ...productFields, sku, tenantId, targetMargin: margin, status: productFields.status ?? 'active' },
    })

    const warehouses = await this.prisma.warehouse.findMany({
      where: { tenantId, active: true, warehouseType: { in: ['online', 'warehouse', 'store'] }, isDefault: true },
    })

    const stockByType: Record<string, number> = {
      online: stockOnline ?? 0,
      warehouse: stockWarehouse ?? 0,
      store: stockStore ?? 0,
    }

    if (warehouses.length > 0) {
      await this.prisma.inventory.createMany({
        data: warehouses.map((w) => ({
          tenantId,
          productId: product.id,
          warehouseId: w.id,
          quantity: stockByType[w.warehouseType] ?? 0,
        })),
      })
    }

    return product
  }

  async update(tenantId: string, id: string, dto: UpdateProductDto) {
    await this.findOne(tenantId, id)

    const { stockOnline, stockWarehouse, stockStore, ...productFields } = dto

    const margin = productFields.targetMargin !== undefined
      ? productFields.targetMargin
      : (productFields.basePrice !== undefined || productFields.costPrice !== undefined)
        ? undefined
        : undefined

    await this.prisma.product.update({ where: { id }, data: { ...productFields, targetMargin: margin } })

    const stockUpdates: Record<string, number | undefined> = {
      online: stockOnline,
      warehouse: stockWarehouse,
      store: stockStore,
    }

    for (const [warehouseType, qty] of Object.entries(stockUpdates)) {
      if (qty === undefined) continue
      const wh = await this.prisma.warehouse.findFirst({
        where: { tenantId, warehouseType, isDefault: true, active: true },
      })
      if (!wh) continue
      const inv = await this.prisma.inventory.findFirst({
        where: { productId: id, warehouseId: wh.id, variantId: null },
      })
      if (inv) {
        await this.prisma.inventory.update({ where: { id: inv.id }, data: { quantity: qty } })
      } else {
        await this.prisma.inventory.create({
          data: { tenantId, productId: id, warehouseId: wh.id, quantity: qty, reservedQuantity: 0 },
        })
      }
    }

    return this.findOne(tenantId, id)
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id)
    await this.prisma.product.update({
      where: { id },
      data: { status: 'archived' },
    })
    return { message: 'Producto archivado correctamente' }
  }

  async getStats(tenantId: string) {
    const [total, active, outOfStock, comingSoon, unavailable] = await Promise.all([
      this.prisma.product.count({ where: { tenantId } }),
      this.prisma.product.count({ where: { tenantId, status: 'active' } }),
      this.prisma.product.count({ where: { tenantId, status: 'out_of_stock' } }),
      this.prisma.product.count({ where: { tenantId, status: 'coming_soon' } }),
      this.prisma.product.count({ where: { tenantId, status: 'unavailable' } }),
    ])
    return { total, active, outOfStock, comingSoon, unavailable }
  }

  // ─── Marketplace mappings ──────────────────────────────────────────────────

  async marketplaceStatus(tenantId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
      include: {
        marketplaceMappings: {
          include: { connection: { select: { id: true, provider: true, name: true } } },
        },
      },
    })
    if (!product) throw new NotFoundException('Producto no encontrado')

    const connections = await this.prisma.connection.findMany({
      where: { tenantId, type: { in: ['marketplace', 'ecommerce'] } },
      select: { id: true, provider: true, name: true, status: true },
    })

    return connections.map((conn) => {
      const mapping = product.marketplaceMappings.find((m) => m.connectionId === conn.id)
      return {
        connectionId: conn.id,
        provider: conn.provider,
        connectionName: conn.name,
        connectionStatus: conn.status,
        linked: !!mapping,
        marketplaceProductId: mapping?.marketplaceProductId || null,
        syncStatus: mapping?.syncStatus || 'unlinked',
        errorMessage: mapping?.errorMessage || null,
        lastSyncAt: mapping?.lastSyncAt || null,
      }
    })
  }

  async detectMarketplace(tenantId: string, productId: string, connectionId: string) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, tenantId } })
    if (!product) throw new NotFoundException('Producto no encontrado')

    const connection = await this.prisma.connection.findFirst({
      where: { id: connectionId, tenantId },
    })
    if (!connection) throw new NotFoundException('Conexión no encontrada')

    const driver = getDriver(connection.provider)
    if (!driver.findBySku) {
      throw new ConflictException(`El driver ${connection.provider} no soporta detección por SKU`)
    }

    const matches = await driver.findBySku(
      connection.credentials as Record<string, string>,
      product.sku,
      connection.config as Record<string, unknown> | undefined,
    )

    if (matches.length === 0) {
      // Mark as not_found for visibility, but don't create the mapping
      await this.prisma.marketplaceMapping.upsert({
        where: { productId_connectionId: { productId, connectionId } },
        update: { syncStatus: 'sku_not_found', errorMessage: `SKU "${product.sku}" no encontrado en ${connection.name}` },
        create: {
          productId,
          connectionId,
          syncStatus: 'sku_not_found',
          errorMessage: `SKU "${product.sku}" no encontrado en ${connection.name}`,
        },
      })
      return { matched: 0, status: 'sku_not_found' }
    }

    if (matches.length > 1) {
      await this.prisma.marketplaceMapping.upsert({
        where: { productId_connectionId: { productId, connectionId } },
        update: { syncStatus: 'sku_duplicate', errorMessage: `SKU "${product.sku}" duplicado en ${connection.name} (${matches.length} publicaciones)` },
        create: {
          productId,
          connectionId,
          syncStatus: 'sku_duplicate',
          errorMessage: `SKU "${product.sku}" duplicado en ${connection.name} (${matches.length} publicaciones)`,
        },
      })
      return { matched: matches.length, status: 'sku_duplicate', candidates: matches.map((m) => ({ id: m.externalId, title: m.title })) }
    }

    // Exactly 1 match — link it
    const m = matches[0]
    await this.prisma.marketplaceMapping.upsert({
      where: { productId_connectionId: { productId, connectionId } },
      update: {
        marketplaceProductId: m.externalId,
        marketplaceSku: m.externalSku || product.sku,
        marketplacePrice: m.price,
        syncStatus: 'connected',
        errorMessage: null,
        lastSyncAt: new Date(),
      },
      create: {
        productId,
        connectionId,
        marketplaceProductId: m.externalId,
        marketplaceSku: m.externalSku || product.sku,
        marketplacePrice: m.price,
        syncStatus: 'connected',
        lastSyncAt: new Date(),
      },
    })
    return { matched: 1, status: 'connected', marketplaceProductId: m.externalId, title: m.title }
  }

  async fetchMarketplaceProducts(
    tenantId: string,
    connectionId: string,
    offset = 0,
    limit = 25,
    filters: { status?: string; stock?: string; search?: string; linked?: string } = {},
  ) {
    const connection = await this.prisma.connection.findFirst({
      where: { id: connectionId, tenantId },
    })
    if (!connection) throw new NotFoundException('Conexión no encontrada')

    const driver = getDriver(connection.provider)
    const cfg = connection.config as Record<string, unknown> | undefined
    const { status, stock, search, linked } = filters

    // status + search go to the driver (ML supports both natively)
    const driverCfg: Record<string, unknown> = { ...(cfg as any) }
    if (status) driverCfg.statusFilter = status
    if (search) driverCfg.searchQuery = search

    const result = await driver.getProducts(
      connection.credentials as Record<string, string>,
      driverCfg,
      offset,
      limit,
    )

    // Cross-reference with local mappings for the "vinculado" badge
    const externalIds = result.items.map((p) => p.externalId).filter(Boolean)
    const mappings = externalIds.length
      ? await this.prisma.marketplaceMapping.findMany({
          where: { connectionId, marketplaceProductId: { in: externalIds } },
          include: { product: { select: { id: true, sku: true, name: true } } },
        })
      : []
    const mappingByExternalId = new Map(mappings.map((m) => [m.marketplaceProductId, m]))

    let items = result.items.map((p) => {
      const mapping = mappingByExternalId.get(p.externalId)
      return {
        externalId: p.externalId,
        externalSku: p.externalSku,
        title: p.title,
        price: p.price,
        stock: p.stock,
        status: p.status,
        images: p.images || [],
        categoryId: p.categoryId,
        url: p.url,
        mapping: mapping
          ? {
              masterProductId: mapping.product?.id,
              masterSku: mapping.product?.sku,
              masterName: mapping.product?.name,
              syncStatus: mapping.syncStatus,
            }
          : null,
      }
    })

    // stock / linked filters applied on the returned page (ML doesn't support these natively)
    if (stock === 'in_stock')       items = items.filter((p) => p.stock > 0)
    else if (stock === 'out_of_stock') items = items.filter((p) => !(p.stock > 0))
    if (linked === 'linked')        items = items.filter((p) => p.mapping !== null)
    else if (linked === 'unlinked') items = items.filter((p) => p.mapping === null)

    return {
      data: items,
      meta: { total: result.total, offset: result.offset, limit: result.limit, hasMore: result.hasMore },
    }
  }

  invalidateMpCache(_connectionId: string) { /* kept for API compat */ }

  async unlinkMarketplace(tenantId: string, productId: string, connectionId: string) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, tenantId } })
    if (!product) throw new NotFoundException('Producto no encontrado')

    await this.prisma.marketplaceMapping.deleteMany({
      where: { productId, connectionId },
    })
    return { unlinked: true }
  }

  // ─── Paris-specific helpers ────────────────────────────────────────────────

  // Resolves the Paris connection for the tenant (one per tenant per provider).
  private async parisConnection(tenantId: string) {
    const conn = await this.prisma.connection.findFirst({
      where: { tenantId, provider: 'paris' },
    })
    if (!conn) throw new NotFoundException('No hay conexión de Paris configurada')
    return conn
  }

  private parisDriver() {
    return getDriver('paris') as ParisDriver
  }

  async parisFamilies(tenantId: string) {
    const conn = await this.parisConnection(tenantId)
    return this.parisDriver().listFamilies(
      conn.credentials as Record<string, string>,
      conn.config as Record<string, unknown> | undefined,
    )
  }

  async parisCategories(tenantId: string, familyId: string) {
    const conn = await this.parisConnection(tenantId)
    return this.parisDriver().listCategories(
      conn.credentials as Record<string, string>,
      familyId,
      conn.config as Record<string, unknown> | undefined,
    )
  }

  async parisAttributes(tenantId: string, familyId: string, kind: 'product' | 'variant') {
    const conn = await this.parisConnection(tenantId)
    const driver = this.parisDriver()
    const cred = conn.credentials as Record<string, string>
    const cfg = conn.config as Record<string, unknown> | undefined
    return kind === 'variant'
      ? driver.listVariantAttributes(cred, familyId, cfg)
      : driver.listProductAttributes(cred, familyId, cfg)
  }

  async parisAttributeOptions(tenantId: string, attributeId: string, q?: string) {
    const conn = await this.parisConnection(tenantId)
    return this.parisDriver().listAttributeOptions(
      conn.credentials as Record<string, string>,
      attributeId,
      conn.config as Record<string, unknown> | undefined,
      q,
    )
  }

  async parisPriceTypes(tenantId: string) {
    const conn = await this.parisConnection(tenantId)
    return this.parisDriver().listPriceTypes(
      conn.credentials as Record<string, string>,
      conn.config as Record<string, unknown> | undefined,
    )
  }

  async publishToParis(tenantId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
    })
    if (!product) throw new NotFoundException('Producto no encontrado')

    const data = (product.parisData as any) || {}
    if (!data.familyId || !data.categoryId) {
      throw new BadRequestException(
        'Falta configurar Paris: familia y categoría son obligatorias',
      )
    }

    const conn = await this.parisConnection(tenantId)
    const sellerSku = data.sellerSku || product.sku
    const images = Array.isArray(product.images) ? (product.images as string[]) : []

    const prices = data.priceTypeId
      ? [{ priceTypeId: data.priceTypeId, value: Number(product.basePrice) }]
      : undefined

    const result = await this.parisDriver().publish(
      conn.credentials as Record<string, string>,
      {
        name: product.name,
        sellerSku,
        familyId: data.familyId,
        categoryId: data.categoryId,
        productAttributes: data.productAttributes || [],
        variants: data.variants && data.variants.length > 0
          ? data.variants
          : undefined,
        images,
        prices,
      },
      conn.config as Record<string, unknown> | undefined,
    )

    if (result.success && result.externalId) {
      await this.prisma.marketplaceMapping.upsert({
        where: { productId_connectionId: { productId, connectionId: conn.id } },
        update: {
          marketplaceProductId: result.externalId,
          marketplaceSku: sellerSku,
          marketplacePrice: product.basePrice,
          syncStatus: 'connected',
          errorMessage: null,
          lastSyncAt: new Date(),
        },
        create: {
          productId,
          connectionId: conn.id,
          marketplaceProductId: result.externalId,
          marketplaceSku: sellerSku,
          marketplacePrice: product.basePrice,
          syncStatus: 'connected',
          lastSyncAt: new Date(),
        },
      })
    }

    return result
  }

  async getMarketplacePricing(tenantId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
      select: { id: true, basePrice: true, marketplacePricing: true },
    })
    if (!product) throw new NotFoundException('Producto no encontrado')
    return { basePrice: product.basePrice, pricing: product.marketplacePricing ?? {} }
  }

  async updateMarketplacePricing(tenantId: string, productId: string, data: any) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, tenantId } })
    if (!product) throw new NotFoundException('Producto no encontrado')
    return this.prisma.product.update({
      where: { id: productId },
      data: { marketplacePricing: data },
      select: { id: true, marketplacePricing: true },
    })
  }

  async updateParisData(tenantId: string, productId: string, data: any) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
    })
    if (!product) throw new NotFoundException('Producto no encontrado')

    return this.prisma.product.update({
      where: { id: productId },
      data: { parisData: data },
      select: { id: true, parisData: true },
    })
  }
}
