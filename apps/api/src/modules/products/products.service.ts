import { Injectable, NotFoundException, ConflictException, BadRequestException, Inject, forwardRef } from '@nestjs/common'
import * as ExcelJS from 'exceljs'
import { PrismaService } from '../../prisma/prisma.service'
import { CreateProductDto, UpdateProductDto, ProductQueryDto } from './dto/product.dto'
import { getDriver, ParisDriver } from '@stockcentral/integrations'
import { MarketplaceCacheService } from './marketplace-cache.service'
import { InventoryService } from '../inventory/inventory.service'

@Injectable()
export class ProductsService {
  constructor(
    private prisma: PrismaService,
    private marketplaceCache: MarketplaceCacheService,
    @Inject(forwardRef(() => InventoryService)) private inventoryService: InventoryService,
  ) {}

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
            include: { warehouse: { select: { name: true, warehouseType: true } } },
          },
          marketplaceMappings: {
            select: {
              connectionId: true,
              marketplaceProductId: true,
              syncStatus: true,
            },
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

    // Normalize barcode: empty string → omit (don't persist '').
    const barcode = productFields.barcode?.trim() || undefined

    const product = await this.prisma.product.create({
      data: { ...productFields, sku, tenantId, targetMargin: margin, status: productFields.status ?? 'active', barcode },
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

    const { stockOnline, stockWarehouse, stockStore, saleStartDate, saleEndDate, ...productFields } = dto

    const margin = productFields.targetMargin !== undefined
      ? productFields.targetMargin
      : (productFields.basePrice !== undefined || productFields.costPrice !== undefined)
        ? undefined
        : undefined

    // Empty barcode string from the form means "clear it" → store null.
    const barcode =
      productFields.barcode === undefined
        ? undefined
        : productFields.barcode.trim() === ''
        ? null
        : productFields.barcode.trim()

    await this.prisma.product.update({
      where: { id },
      data: {
        ...productFields,
        targetMargin: margin,
        barcode: barcode as any,
        ...(saleStartDate !== undefined ? { saleStartDate: saleStartDate ? new Date(saleStartDate) : null } : {}),
        ...(saleEndDate !== undefined ? { saleEndDate: saleEndDate ? new Date(saleEndDate) : null } : {}),
      },
    })

    const stockUpdates: Record<string, number | undefined> = {
      online: stockOnline,
      warehouse: stockWarehouse,
      store: stockStore,
    }

    // Solo trackear cambio de stock para los warehouses online/store
    // (warehouse internal no se publica, no necesita fan-out).
    let onlineStoreStockChanged = false
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
        if (inv.quantity !== qty) {
          await this.prisma.inventory.update({ where: { id: inv.id }, data: { quantity: qty } })
          if (warehouseType === 'online' || warehouseType === 'store') onlineStoreStockChanged = true
        }
      } else {
        await this.prisma.inventory.create({
          data: { tenantId, productId: id, warehouseId: wh.id, quantity: qty, reservedQuantity: 0 },
        })
        if (warehouseType === 'online' || warehouseType === 'store') onlineStoreStockChanged = true
      }
    }

    // Fan-out a marketplaces si cambió stock publicable
    if (onlineStoreStockChanged) {
      const newTotal = await this.inventoryService.totalStockForProduct(tenantId, id)
      await this.inventoryService.pushStockToMarketplaces(tenantId, id, newTotal)
    }

    return this.findOne(tenantId, id)
  }

  async remove(tenantId: string, id: string) {
    const product = await this.findOne(tenantId, id)

    // Block delete if the product is still published in some marketplace.
    // The user must unlink (or unpublish) before removing — prevents leaving
    // dangling listings without a master product.
    const activeMappings = (product as any).marketplaceMappings?.filter(
      (m: any) => m.marketplaceProductId,
    ) ?? []
    if (activeMappings.length) {
      const linkedMarketplaces = activeMappings.map((m: any) => ({
        connectionId: m.connectionId,
        provider: m.connection?.provider,
        connectionName: m.connection?.name,
        marketplaceProductId: m.marketplaceProductId,
      }))
      const providers = [...new Set(linkedMarketplaces.map((m: any) => m.provider))].join(', ')
      throw new BadRequestException({
        message: `El producto está vinculado a: ${providers}. Desvincula antes de eliminar.`,
        code: 'PRODUCT_HAS_LINKED_MARKETPLACES',
        linkedMarketplaces,
      })
    }

    // Hard delete. Inventory, ProductVariant, StockMovement and MarketplaceMapping
    // cascade automatically. OrderItem.productId has no FK so historical sales
    // keep their denormalized sku/name and survive the deletion.
    await this.prisma.product.delete({ where: { id } })
    return { message: 'Producto eliminado' }
  }

  async exportActiveCatalog(tenantId: string): Promise<{ buffer: Buffer; filename: string }> {
    const products = await this.prisma.product.findMany({
      where: { tenantId, status: 'active' },
      orderBy: { sku: 'asc' },
      select: {
        sku: true,
        name: true,
        costPrice: true,
        basePrice: true,
        inventory: {
          where: { variantId: null },
          select: { quantity: true },
        },
      },
    })

    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'StockCentral'
    workbook.created = new Date()
    const sheet = workbook.addWorksheet('Catálogo activo')

    sheet.columns = [
      { header: 'SKU', key: 'sku', width: 16 },
      { header: 'Nombre', key: 'name', width: 60 },
      { header: 'Precio Costo', key: 'costPrice', width: 16, style: { numFmt: '#,##0' } },
      { header: 'Precio Base', key: 'basePrice', width: 16, style: { numFmt: '#,##0' } },
      { header: 'Stock', key: 'stock', width: 10 },
    ]
    sheet.getRow(1).font = { bold: true }
    sheet.getRow(1).alignment = { vertical: 'middle' }

    for (const p of products) {
      const stock = p.inventory.reduce((s, i) => s + i.quantity, 0)
      sheet.addRow({
        sku: p.sku,
        name: p.name,
        costPrice: p.costPrice ? Number(p.costPrice) : null,
        basePrice: Number(p.basePrice),
        stock,
      })
    }

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
    const today = new Date().toISOString().slice(0, 10)
    const filename = `catalogo-activos-${today}.xlsx`
    return { buffer, filename }
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

    // Solo destinos reales de sync — excluimos:
    //   - Facturadores (type='billing', ej. Bsale): no son marketplaces.
    //   - Catalog sources (isCatalogSource=true, ej. EYLSTORE): son la fuente
    //     del catálogo maestro, no destino de publicación. Aparecen mapeados
    //     pero no se sincronizan hacia ellos.
    const connections = await this.prisma.connection.findMany({
      where: {
        tenantId,
        type: { in: ['marketplace', 'ecommerce'] },
        isCatalogSource: false,
      },
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

  // Vincula manualmente un producto del maestro a una publicación específica
  // del marketplace (cuando el SKU del seller no coincide o hay duplicados).
  async linkMarketplace(
    tenantId: string,
    productId: string,
    connectionId: string,
    externalId: string,
    marketplaceSku?: string,
    price?: number,
    title?: string,
  ) {
    if (!externalId) throw new BadRequestException('externalId es obligatorio')

    const product = await this.prisma.product.findFirst({ where: { id: productId, tenantId } })
    if (!product) throw new NotFoundException('Producto no encontrado')
    const connection = await this.prisma.connection.findFirst({ where: { id: connectionId, tenantId } })
    if (!connection) throw new NotFoundException('Conexión no encontrada')

    // Si el caller no manda price/title/sku, los traemos del marketplace para guardarlos
    let resolvedSku = marketplaceSku
    let resolvedPrice = price
    let resolvedTitle = title
    if (!resolvedSku || resolvedPrice === undefined) {
      try {
        const driver = getDriver(connection.provider)
        if (driver.getProduct) {
          const m = await driver.getProduct(
            connection.credentials as Record<string, string>,
            externalId,
            connection.config as Record<string, unknown> | undefined,
          )
          if (m) {
            resolvedSku = resolvedSku ?? m.externalSku ?? product.sku
            resolvedPrice = resolvedPrice ?? m.price
            resolvedTitle = resolvedTitle ?? m.title
          }
        }
      } catch {
        // si no se puede consultar el marketplace, igual creamos el mapping con los datos del maestro
      }
    }

    const mapping = await this.prisma.marketplaceMapping.upsert({
      where: { productId_connectionId: { productId, connectionId } },
      update: {
        marketplaceProductId: externalId,
        marketplaceSku: resolvedSku ?? product.sku,
        marketplacePrice: resolvedPrice ?? Number(product.basePrice),
        syncStatus: 'connected',
        errorMessage: null,
        lastSyncAt: new Date(),
      },
      create: {
        productId,
        connectionId,
        marketplaceProductId: externalId,
        marketplaceSku: resolvedSku ?? product.sku,
        marketplacePrice: resolvedPrice ?? Number(product.basePrice),
        syncStatus: 'connected',
        lastSyncAt: new Date(),
      },
    })

    return {
      matched: 1,
      status: 'connected',
      marketplaceProductId: externalId,
      title: resolvedTitle,
      mapping,
    }
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

    const { status, stock, search, linked } = filters

    // Lectura del cache local (MarketplaceProductSnapshot). El cron lo llena
    // cada 30 min; el botón "Refrescar" lo dispara on-demand. Si NUNCA se
    // llenó (primera vez), caemos al fetch sincrónico abajo para no
    // mostrar lista vacía.
    const hasCache = await this.marketplaceCache.hasCache(connectionId)
    if (hasCache) {
      return this.fetchMarketplaceProductsFromCache(
        connectionId,
        offset,
        limit,
        filters,
      )
    }

    // ── Fallback: fetch sincrónico al marketplace (legacy path). Solo se
    // usa la primera vez antes de que el cron llene el cache, o si el
    // cache fue borrado a mano. El driver tarda ~15s con Lider porque
    // enriquece stock por producto — por eso el cache existe.
    const driver = getDriver(connection.provider)
    const cfg = connection.config as Record<string, unknown> | undefined
    const driverCfg: Record<string, unknown> = { ...(cfg as any) }
    if (status) driverCfg.statusFilter = status
    if (search) driverCfg.searchQuery = search

    const result = await driver.getProducts(
      connection.credentials as Record<string, string>,
      driverCfg,
      offset,
      limit,
    )

    return this.attachMappingsAndFilter(
      connectionId,
      result.items,
      filters,
      { total: result.total, offset: result.offset, limit: result.limit, hasMore: result.hasMore },
    )
  }

  // Lee productos del marketplace desde el cache local. Toda la lógica
  // de filtros (status, search, linked, stock) corre en Postgres → es
  // instantáneo aunque haya 10k productos.
  private async fetchMarketplaceProductsFromCache(
    connectionId: string,
    offset: number,
    limit: number,
    filters: { status?: string; stock?: string; search?: string; linked?: string },
  ) {
    const { status, stock, search, linked } = filters

    // WHERE base
    const where: any = { connectionId }
    if (status) where.status = status
    if (stock === 'in_stock') where.stock = { gt: 0 }
    else if (stock === 'out_of_stock') where.OR = [{ stock: 0 }, { stock: null }]
    if (search) {
      const q = search.trim()
      const orSearch = [
        { externalId: { contains: q, mode: 'insensitive' as const } },
        { externalSku: { contains: q, mode: 'insensitive' as const } },
        { title: { contains: q, mode: 'insensitive' as const } },
      ]
      // Combina con `OR` existente si lo había (caso out_of_stock)
      where.AND = (where.OR ? [{ OR: where.OR }] : []).concat([{ OR: orSearch }])
      delete where.OR
    }

    const [data, total] = await Promise.all([
      this.prisma.marketplaceProductSnapshot.findMany({
        where,
        skip: offset,
        take: limit,
        orderBy: { lastFetchedAt: 'desc' },
      }),
      this.prisma.marketplaceProductSnapshot.count({ where }),
    ])

    // Forma compatible con la respuesta legacy
    const items = data.map((p) => ({
      externalId: p.externalId,
      externalSku: p.externalSku,
      title: p.title,
      description: undefined,
      price: p.price ? Number(p.price) : 0,
      stock: p.stock ?? 0,
      status: p.status || 'unknown',
      images: (p.images as string[] | null) || [],
      categoryId: p.categoryId,
      url: p.url,
      rawData: p.rawData,
    }))

    const enriched = await this.attachMappingsAndFilter(
      connectionId,
      items,
      { linked },
      { total, offset, limit, hasMore: offset + items.length < total },
    )
    return enriched
  }

  // Cruza una lista de items del marketplace con MarketplaceMapping
  // (badge "vinculado") y aplica filtro linked/unlinked sobre la página.
  // Compartido entre el path cache y el path fallback.
  private async attachMappingsAndFilter(
    connectionId: string,
    rawItems: any[],
    filters: { linked?: string },
    meta: { total: number; offset: number; limit: number; hasMore: boolean },
  ) {
    const externalIds = rawItems.map((p) => p.externalId).filter(Boolean)
    const mappings = externalIds.length
      ? await this.prisma.marketplaceMapping.findMany({
          where: { connectionId, marketplaceProductId: { in: externalIds } },
          include: { product: { select: { id: true, sku: true, name: true, images: true } } },
        })
      : []
    const mappingByExternalId = new Map(mappings.map((m) => [m.marketplaceProductId, m]))

    let items = rawItems.map((p) => {
      const mapping = mappingByExternalId.get(p.externalId)
      const marketImages = p.images || []
      const masterImages = (mapping?.product?.images as string[] | null) || []
      const images = marketImages.length > 0 ? marketImages : masterImages
      return {
        externalId: p.externalId,
        externalSku: p.externalSku,
        title: p.title,
        price: p.price,
        stock: p.stock,
        status: p.status,
        images,
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

    if (filters.linked === 'linked') items = items.filter((p) => p.mapping !== null)
    else if (filters.linked === 'unlinked') items = items.filter((p) => p.mapping === null)

    return { data: items, meta }
  }

  async fetchMarketplaceProductDetail(tenantId: string, connectionId: string, externalId: string) {
    const connection = await this.prisma.connection.findFirst({ where: { id: connectionId, tenantId } })
    if (!connection) throw new NotFoundException('Conexión no encontrada')

    const driver = getDriver(connection.provider)
    const product = await driver.getProduct(
      connection.credentials as Record<string, string>,
      externalId,
      connection.config as Record<string, unknown> | undefined,
    )
    if (!product) throw new NotFoundException('Producto no encontrado en el marketplace')

    const mapping = await this.prisma.marketplaceMapping.findFirst({
      where: { connectionId, marketplaceProductId: product.externalId },
      include: { product: { select: { id: true, sku: true, name: true } } },
    })

    return {
      ...product,
      mapping: mapping
        ? {
            masterProductId: mapping.product?.id,
            masterSku: mapping.product?.sku,
            masterName: mapping.product?.name,
            syncStatus: mapping.syncStatus,
          }
        : null,
    }
  }

  invalidateMpCache(_connectionId: string) { /* kept for API compat */ }

  // Dispara un refresh del cache de productos del marketplace. Síncrono
  // (espera a que termine) para que el botón "Refrescar" en la UI sepa
  // cuándo invalidar la query de React.
  async refreshMarketplaceCache(tenantId: string, connectionId: string) {
    // Verificar tenant para que no se pueda refrescar conexiones ajenas
    const conn = await this.prisma.connection.findFirst({
      where: { id: connectionId, tenantId },
      select: { id: true },
    })
    if (!conn) throw new NotFoundException('Conexión no encontrada')
    return this.marketplaceCache.refreshConnection(connectionId)
  }

  // Estado del cache: cuándo fue la última actualización y cuántos
  // productos hay. Lo consume la UI para mostrar "actualizado hace X min".
  async getMarketplaceCacheStatus(tenantId: string, connectionId: string) {
    const conn = await this.prisma.connection.findFirst({
      where: { id: connectionId, tenantId },
      select: { id: true },
    })
    if (!conn) throw new NotFoundException('Conexión no encontrada')
    const [count, lastFetchedAt] = await Promise.all([
      this.prisma.marketplaceProductSnapshot.count({ where: { connectionId } }),
      this.marketplaceCache.getLastFetchedAt(connectionId),
    ])
    return { count, lastFetchedAt }
  }

  async unlinkMarketplace(tenantId: string, productId: string, connectionId: string) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, tenantId } })
    if (!product) throw new NotFoundException('Producto no encontrado')

    await this.prisma.marketplaceMapping.deleteMany({
      where: { productId, connectionId },
    })
    return { unlinked: true }
  }

  // Sobreescribe SOLO el calculatedPrice del marketplace en la calculadora.
  // No toca commission/margin/shipping — quedan inconsistentes con el
  // nuevo calculatedPrice (decisión consciente: el operador edita
  // calculatedPrice directamente desde la UI de ofertas y entiende que el
  // resto de la calculadora no se reajusta).
  async setMarketplaceCalculatedPrice(
    tenantId: string,
    productId: string,
    provider: string,
    calculatedPrice: number,
  ) {
    if (!calculatedPrice || calculatedPrice <= 0) {
      throw new BadRequestException('calculatedPrice debe ser mayor a 0')
    }
    const product = await this.prisma.product.findFirst({ where: { id: productId, tenantId } })
    if (!product) throw new NotFoundException('Producto no encontrado')
    const pricing = ((product.marketplacePricing as any) || {}) as Record<string, any>
    const existing = pricing[provider] || {}
    const next = {
      ...pricing,
      [provider]: {
        ...existing,
        calculatedPrice: Math.round(calculatedPrice),
        // Marca que el precio se editó manualmente (útil para reportes).
        manualOverride: true,
        manualOverrideAt: new Date().toISOString(),
      },
    }
    return this.prisma.product.update({
      where: { id: productId },
      data: { marketplacePricing: next as any },
    })
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

  async publishToParis(tenantId: string, productId: string, override?: any) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
      include: {
        inventory: { select: { quantity: true, reservedQuantity: true } },
      },
    })
    if (!product) throw new NotFoundException('Producto no encontrado')

    // Form payload comes from the UI on publish. We persist it to parisData so
    // future updates / re-pricing can re-use the same configuration without
    // re-asking the user for everything.
    const data = override || (product.parisData as any) || {}
    if (!data.familyId || !data.categoryId) {
      throw new BadRequestException(
        'Falta configurar Paris: familia y categoría son obligatorias',
      )
    }

    const conn = await this.parisConnection(tenantId)
    const sellerSku = data.sellerSku || product.sku
    const images = Array.isArray(product.images) ? (product.images as string[]) : []

    // Prices: support either a single { priceTypeId, value } or an array.
    // Each item maps to one row uploaded via POST /v2/prices/product/{productId}.
    let prices: Array<{ priceTypeId: string; value: number; startDate?: string; endDate?: string }> | undefined
    if (Array.isArray(data.prices) && data.prices.length > 0) {
      prices = data.prices
        .filter((p: any) => p?.priceTypeId && p?.value)
        .map((p: any) => ({
          priceTypeId: p.priceTypeId,
          value: Number(p.value),
          startDate: p.startDate,
          endDate: p.endDate,
        }))
    } else if (data.priceTypeId) {
      prices = [{ priceTypeId: data.priceTypeId, value: Number(product.basePrice) }]
    }

    // Initial stock: sum of (quantity - reserved) across all warehouses for the product.
    // Negative values are floored to 0.
    const totalStock = (product.inventory || []).reduce((sum, inv) => {
      const available = (inv.quantity || 0) - (inv.reservedQuantity || 0)
      return sum + Math.max(0, available)
    }, 0)

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
        // initialStock is read by the driver and pushed via POST /v2/stock per variant
        initialStock: totalStock,
      } as any,
      conn.config as Record<string, unknown> | undefined,
    )

    if (result.success && result.externalId) {
      // Persist parisData so future re-publishes / price updates don't need the form
      if (override) {
        await this.prisma.product.update({
          where: { id: productId },
          data: { parisData: data },
        })
      }

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
