import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bull'
import { Cron, CronExpression } from '@nestjs/schedule'
import { Queue } from 'bull'
import { PrismaService } from '../../prisma/prisma.service'
import { getDriver } from '@stockcentral/integrations'
import { SYNC_QUEUE, SyncJobType } from './sync.constants'

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name)

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(SYNC_QUEUE) private readonly syncQueue: Queue,
  ) {}

  // ─── Queue Helpers ────────────────────────────────────────────────────────

  async enqueueProductsOutbound(tenantId: string, connectionId: string, productIds?: string[]) {
    return this.syncQueue.add(
      SyncJobType.SYNC_PRODUCTS_OUTBOUND,
      { tenantId, connectionId, productIds },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    )
  }

  async enqueueProductsInbound(tenantId: string, connectionId: string) {
    return this.syncQueue.add(
      SyncJobType.SYNC_PRODUCTS_INBOUND,
      { tenantId, connectionId },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    )
  }

  async enqueueOrdersInbound(tenantId: string, connectionId: string, since?: Date) {
    return this.syncQueue.add(
      SyncJobType.SYNC_ORDERS_INBOUND,
      { tenantId, connectionId, since: since?.toISOString() },
      { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
    )
  }

  async enqueueStockSync(
    tenantId: string,
    connectionId: string,
    productId: string,
    externalId: string,
    stock: number,
  ) {
    return this.syncQueue.add(
      SyncJobType.SYNC_STOCK,
      { tenantId, connectionId, productId, externalId, stock },
      { attempts: 5, backoff: { type: 'exponential', delay: 2000 } },
    )
  }

  // ─── Cron Jobs ────────────────────────────────────────────────────────────

  @Cron(CronExpression.EVERY_5_MINUTES)
  async scheduledOrdersInbound() {
    const connections = await this.prisma.connection.findMany({
      where: { syncEnabled: true, status: 'connected' },
      select: { id: true, tenantId: true, lastSync: true },
    })

    for (const conn of connections) {
      await this.enqueueOrdersInbound(conn.tenantId, conn.id, conn.lastSync || undefined)
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async scheduledProductsOutbound() {
    const connections = await this.prisma.connection.findMany({
      where: { syncEnabled: true, status: 'connected' },
      select: { id: true, tenantId: true },
    })

    for (const conn of connections) {
      await this.enqueueProductsOutbound(conn.tenantId, conn.id)
    }
  }

  // ─── Real Sync Logic ──────────────────────────────────────────────────────

  async syncProductsOutbound(tenantId: string, connectionId: string, productIds?: string[]) {
    const connection = await this.getConnection(tenantId, connectionId)
    const driver = getDriver(connection.provider)
    const credentials = connection.credentials as Record<string, string>
    const config = connection.config as Record<string, unknown> | undefined

    const whereClause: any = { tenantId, status: 'active' }
    if (productIds?.length) whereClause.id = { in: productIds }

    const products = await this.prisma.product.findMany({
      where: whereClause,
      include: {
        inventory: { where: { variantId: null }, take: 1 },
        marketplaceMappings: { where: { connectionId } },
      },
    })

    let synced = 0
    let errors = 0
    const startTime = Date.now()

    for (const product of products) {
      const mapping = product.marketplaceMappings[0]
      const stock = product.inventory[0]?.quantity ?? 0
      const syncInput = {
        sku: product.sku,
        title: product.name,
        description: product.description || undefined,
        price: Number(product.basePrice),
        stock,
        images: (product.images as string[] | null) || [],
      }

      try {
        let result
        if (mapping?.marketplaceProductId) {
          result = await driver.updateProduct(credentials, mapping.marketplaceProductId, syncInput, config)
        } else {
          result = await driver.createProduct(credentials, syncInput, config)
        }

        if (result.success) {
          await this.prisma.marketplaceMapping.upsert({
            where: { productId_connectionId: { productId: product.id, connectionId } },
            update: {
              marketplaceProductId: result.externalId,
              syncStatus: 'success',
              lastSyncAt: new Date(),
              errorMessage: null,
            },
            create: {
              productId: product.id,
              connectionId,
              marketplaceProductId: result.externalId,
              syncStatus: 'success',
              lastSyncAt: new Date(),
            },
          })
          synced++
        } else {
          await this.updateMappingError(product.id, connectionId, result.error || 'Unknown error')
          errors++
        }
      } catch (err: any) {
        await this.updateMappingError(product.id, connectionId, err.message)
        errors++
      }
    }

    const duration = Date.now() - startTime
    await this.logSync(tenantId, connectionId, 'outbound', 'sync_products', 'product', null, synced > 0 ? 'success' : 'error', duration, { synced, errors, total: products.length })
    await this.prisma.connection.update({
      where: { id: connectionId },
      data: { lastSync: new Date(), status: 'connected' },
    })

    return { synced, errors, total: products.length }
  }

  // Marketplaces are sales channels, not catalog sources.
  // Inbound product sync only applies to e-commerce integrations (Shopify, WooCommerce, etc.).
  private static readonly CATALOG_SOURCE_PROVIDERS = new Set(['shopify', 'woocommerce', 'jumpseller', 'prestashop'])

  async syncProductsInbound(tenantId: string, connectionId: string) {
    const connection = await this.getConnection(tenantId, connectionId)

    if (!SyncService.CATALOG_SOURCE_PROVIDERS.has(connection.provider)) {
      this.logger.log(`Skipping inbound product sync for marketplace provider: ${connection.provider}`)
      return { upserted: 0, errors: 0, skipped: true }
    }

    const driver = getDriver(connection.provider)
    const credentials = connection.credentials as Record<string, string>
    const config = connection.config as Record<string, unknown> | undefined

    // Get (or create) the default warehouse for this tenant
    let warehouse = await this.prisma.warehouse.findFirst({ where: { tenantId, active: true } })
    if (!warehouse) {
      warehouse = await this.prisma.warehouse.create({
        data: { tenantId, name: 'Principal', type: 'physical', active: true },
      })
    }
    const warehouseId = warehouse.id

    let offset = 0
    const limit = 50
    let upserted = 0
    let errors = 0
    const startTime = Date.now()

    while (true) {
      const result = await driver.getProducts(credentials, config, offset, limit)

      for (const mp of result.items) {
        const sku = String(mp.externalSku || mp.externalId)
        try {
          const product = await this.prisma.product.upsert({
            where: { tenantId_sku: { tenantId, sku } },
            update: {
              name: mp.title,
              description: mp.description || null,
              basePrice: mp.price,
              images: mp.images as any,
              status: mp.status === 'active' ? 'active' : 'inactive',
            },
            create: {
              tenantId,
              sku,
              name: mp.title,
              description: mp.description || null,
              basePrice: mp.price,
              images: mp.images as any,
              status: mp.status === 'active' ? 'active' : 'inactive',
            },
          })

          const existingInv = await this.prisma.inventory.findFirst({
            where: { productId: product.id, variantId: null, warehouseId },
          })
          if (existingInv) {
            await this.prisma.inventory.update({ where: { id: existingInv.id }, data: { quantity: mp.stock } })
          } else {
            await this.prisma.inventory.create({ data: { tenantId, productId: product.id, variantId: null, warehouseId, quantity: mp.stock, reservedQuantity: 0 } })
          }

          await this.prisma.marketplaceMapping.upsert({
            where: { productId_connectionId: { productId: product.id, connectionId } },
            update: {
              marketplaceProductId: mp.externalId,
              syncStatus: 'success',
              lastSyncAt: new Date(),
              errorMessage: null,
            },
            create: {
              productId: product.id,
              connectionId,
              marketplaceProductId: mp.externalId,
              syncStatus: 'success',
              lastSyncAt: new Date(),
            },
          })

          upserted++
        } catch (err: any) {
          this.logger.error(`Error upserting product ${mp.externalSku}: ${err.message}`)
          errors++
        }
      }

      if (!result.hasMore) break
      offset += limit
    }

    const duration = Date.now() - startTime
    await this.logSync(tenantId, connectionId, 'inbound', 'sync_products_inbound', 'product', null, upserted > 0 || errors === 0 ? 'success' : 'error', duration, { upserted, errors })
    await this.prisma.connection.update({
      where: { id: connectionId },
      data: { lastSync: new Date(), status: 'connected' },
    })

    return { upserted, errors }
  }

  async syncOrdersInbound(tenantId: string, connectionId: string, since?: Date) {
    const connection = await this.getConnection(tenantId, connectionId)
    const driver = getDriver(connection.provider)
    const credentials = connection.credentials as Record<string, string>
    const config = connection.config as Record<string, unknown> | undefined

    let offset = 0
    const limit = 50
    let created = 0
    let errors = 0
    const startTime = Date.now()

    while (true) {
      const result = await driver.getOrders(credentials, config, since, offset, limit)

      for (const marketOrder of result.items) {
        try {
          const existing = await this.prisma.order.findFirst({
            where: { tenantId, externalOrderId: marketOrder.externalId, source: connection.provider },
          })
          if (existing) {
            // If the order already has a Sale and no packId is given, keep its current Sale.
            // Only re-resolve when a packId arrived (potential regrouping) or when no Sale yet.
            let targetSaleId: string
            if (marketOrder.packId || !existing.saleId) {
              const targetSale = await this.resolveSale(tenantId, connection.provider, marketOrder)
              targetSaleId = targetSale.id
            } else {
              targetSaleId = existing.saleId
            }
            const previousSaleId = existing.saleId
            await this.prisma.order.update({
              where: { id: existing.id },
              data: {
                saleId: targetSaleId,
                packId: marketOrder.packId || existing.packId,
                customerName: marketOrder.buyerName,
                customerEmail: marketOrder.buyerEmail || null,
                customerPhone: marketOrder.buyerPhone || null,
                customerDocType: marketOrder.buyerDocType || null,
                customerDocNumber: marketOrder.buyerDocNumber || null,
                invoiceType: marketOrder.billing?.invoiceType || 'boleta',
                billingName: marketOrder.billing?.name || null,
                billingDocType: marketOrder.billing?.docType || null,
                billingDocNumber: marketOrder.billing?.docNumber || null,
                billingEmail: marketOrder.billing?.email || null,
                billingPhone: marketOrder.billing?.phone || null,
                economicActivity: marketOrder.billing?.economicActivity || null,
                taxContributor: marketOrder.billing?.taxContributor || null,
                shippingAddress: (marketOrder.shippingAddress as any) ?? undefined,
                billingAddress: (marketOrder.billingAddress as any) ?? undefined,
                status: this.mapMarketplaceOrderStatus(marketOrder.status),
                paymentStatus: this.mapPaymentStatus(marketOrder.status),
                shipmentStatus: this.mapShipmentStatus(marketOrder.status),
              },
            })
            await this.recalculateSale(targetSaleId)
            if (previousSaleId && previousSaleId !== targetSaleId) {
              await this.cleanupSaleIfEmpty(previousSaleId)
            }
            continue
          }

          const orderNumber = `${connection.provider.toUpperCase()}-${marketOrder.externalOrderNumber || marketOrder.externalId}`
          const sale = await this.resolveSale(tenantId, connection.provider, marketOrder)

          await this.prisma.order.create({
            data: {
              tenantId,
              saleId: sale.id,
              orderNumber,
              source: connection.provider,
              sourceChannel: connection.name,
              externalOrderId: marketOrder.externalId,
              packId: marketOrder.packId || null,
              customerName: marketOrder.buyerName,
              customerEmail: marketOrder.buyerEmail || null,
              customerPhone: marketOrder.buyerPhone || null,
              customerDocType: marketOrder.buyerDocType || null,
              customerDocNumber: marketOrder.buyerDocNumber || null,
              invoiceType: marketOrder.billing?.invoiceType || 'boleta',
              billingName: marketOrder.billing?.name || null,
              billingDocType: marketOrder.billing?.docType || null,
              billingDocNumber: marketOrder.billing?.docNumber || null,
              billingEmail: marketOrder.billing?.email || null,
              billingPhone: marketOrder.billing?.phone || null,
              economicActivity: marketOrder.billing?.economicActivity || null,
              taxContributor: marketOrder.billing?.taxContributor || null,
              subtotal: marketOrder.subtotal,
              shippingCost: marketOrder.shippingCost,
              tax: 0,
              discount: 0,
              total: marketOrder.total,
              currency: marketOrder.currency,
              status: this.mapMarketplaceOrderStatus(marketOrder.status),
              paymentStatus: this.mapPaymentStatus(marketOrder.status),
              shipmentStatus: this.mapShipmentStatus(marketOrder.status),
              shippingAddress: marketOrder.shippingAddress as any,
              billingAddress: marketOrder.billingAddress as any,
              items: {
                create: marketOrder.items.map((item) => ({
                  sku: item.sku,
                  name: item.title,
                  quantity: item.quantity,
                  unitPrice: item.unitPrice,
                  totalPrice: item.totalPrice,
                })),
              },
            },
          })
          await this.recalculateSale(sale.id)
          created++
        } catch (err: any) {
          this.logger.error(`Error creating order ${marketOrder.externalId}: ${err.message}`)
          errors++
        }
      }

      if (!result.hasMore) break
      offset += limit
    }

    const duration = Date.now() - startTime
    await this.logSync(tenantId, connectionId, 'inbound', 'sync_orders', 'order', null, created > 0 || errors === 0 ? 'success' : 'error', duration, { created, errors })
    await this.prisma.connection.update({
      where: { id: connectionId },
      data: { lastSync: new Date(), status: 'connected' },
    })

    return { created, errors }
  }

  async syncSingleStock(
    tenantId: string,
    connectionId: string,
    productId: string,
    externalId: string,
    stock: number,
  ) {
    const connection = await this.getConnection(tenantId, connectionId)
    const driver = getDriver(connection.provider)
    const credentials = connection.credentials as Record<string, string>
    const config = connection.config as Record<string, unknown> | undefined

    const result = await driver.updateStock(credentials, externalId, stock, config)
    const startTime = Date.now()

    if (result.success) {
      await this.prisma.marketplaceMapping.updateMany({
        where: { productId, connectionId },
        data: { syncStatus: 'success', lastSyncAt: new Date(), errorMessage: null },
      })
    } else {
      await this.updateMappingError(productId, connectionId, result.error || 'Stock update failed')
    }

    await this.logSync(tenantId, connectionId, 'outbound', 'sync_stock', 'inventory', productId, result.success ? 'success' : 'error', Date.now() - startTime, { stock, externalId })
    return result
  }

  async testConnection(tenantId: string, connectionId: string) {
    const connection = await this.getConnection(tenantId, connectionId)
    const driver = getDriver(connection.provider)
    const credentials = connection.credentials as Record<string, string>
    const config = connection.config as Record<string, unknown> | undefined

    const startTime = Date.now()
    const result = await driver.testConnection(credentials, config)

    await this.prisma.connection.update({
      where: { id: connectionId },
      data: {
        status: result.success ? 'connected' : 'error',
        lastError: result.success ? null : result.error,
      },
    })

    await this.logSync(tenantId, connectionId, 'outbound', 'test_connection', 'connection', connectionId, result.success ? 'success' : 'error', Date.now() - startTime, result)
    return result
  }

  async refreshOAuthToken(tenantId: string, connectionId: string) {
    const connection = await this.getConnection(tenantId, connectionId)
    const driver = getDriver(connection.provider)
    const credentials = connection.credentials as Record<string, string>
    const config = connection.config as Record<string, unknown> | undefined

    if (!driver.refreshToken || !credentials.refreshToken) return

    const tokens = await driver.refreshToken(credentials.refreshToken, config || {})
    const updatedCredentials = {
      ...credentials,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken || credentials.refreshToken,
    }

    await this.prisma.connection.update({
      where: { id: connectionId },
      data: { credentials: updatedCredentials as any },
    })
  }

  // ─── Manual Trigger (from controller) ─────────────────────────────────────

  async triggerFullSync(tenantId: string, connectionId: string) {
    const [ordersJob, productsInJob, productsOutJob] = await Promise.all([
      this.enqueueOrdersInbound(tenantId, connectionId),
      this.enqueueProductsInbound(tenantId, connectionId),
      this.enqueueProductsOutbound(tenantId, connectionId),
    ])
    return {
      message: 'Sincronización encolada',
      jobs: { orders: ordersJob.id, productsIn: productsInJob.id, productsOut: productsOutJob.id },
    }
  }

  async pushProductToMarketplaces(tenantId: string, productId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
      include: {
        inventory: { where: { variantId: null }, take: 1 },
        marketplaceMappings: { include: { connection: true } },
      },
    })
    if (!product) throw new NotFoundException(`Producto ${productId} no encontrado`)

    const stock = product.inventory[0]?.quantity ?? 0
    const images = (product.images as string[] | null) || []
    const results: any[] = []

    for (const mapping of product.marketplaceMappings) {
      const connection = mapping.connection as any
      if (connection.status !== 'connected') continue

      const driver = getDriver(connection.provider)
      const credentials = connection.credentials as Record<string, string>
      const config = connection.config as Record<string, unknown> | undefined
      const externalId = mapping.marketplaceProductId || product.sku

      try {
        // Update product fields
        const updateResult = await driver.updateProduct(credentials, externalId, {
          sku: product.sku,
          title: product.name,
          description: product.description || undefined,
          price: Number(product.basePrice),
          stock,
          images,
        }, config)

        // Update images separately if driver supports it and images are provided
        if (images.length > 0 && driver.updateImages) {
          await driver.updateImages(credentials, externalId, images, config)
        }

        // Update stock separately
        await driver.updateStock(credentials, externalId, stock, config)

        await this.prisma.marketplaceMapping.update({
          where: { id: mapping.id },
          data: { syncStatus: updateResult.success ? 'success' : 'error', lastSyncAt: new Date(), errorMessage: updateResult.success ? null : updateResult.error },
        })

        results.push({ connection: connection.name, success: updateResult.success, error: updateResult.error })
      } catch (err: any) {
        results.push({ connection: connection.name, success: false, error: err.message })
        await this.prisma.marketplaceMapping.update({
          where: { id: mapping.id },
          data: { syncStatus: 'error', errorMessage: err.message },
        })
      }
    }

    return { productId, results }
  }

  async getQueueStats() {
    const [waiting, active, completed, failed] = await Promise.all([
      this.syncQueue.getWaitingCount(),
      this.syncQueue.getActiveCount(),
      this.syncQueue.getCompletedCount(),
      this.syncQueue.getFailedCount(),
    ])
    return { waiting, active, completed, failed }
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private async getConnection(tenantId: string, connectionId: string) {
    const conn = await this.prisma.connection.findFirst({
      where: { id: connectionId, tenantId },
    })
    if (!conn) throw new NotFoundException(`Conexión ${connectionId} no encontrada`)
    return conn
  }

  private async updateMappingError(productId: string, connectionId: string, errorMessage: string) {
    await this.prisma.marketplaceMapping.upsert({
      where: { productId_connectionId: { productId, connectionId } },
      update: { syncStatus: 'error', errorMessage },
      create: { productId, connectionId, syncStatus: 'error', errorMessage },
    })
  }

  private async logSync(
    tenantId: string,
    connectionId: string,
    type: string,
    action: string,
    entity: string,
    entityId: string | null,
    status: string,
    duration: number,
    responseData?: unknown,
  ) {
    await this.prisma.syncLog.create({
      data: {
        tenantId,
        connectionId,
        type,
        action,
        entity,
        entityId,
        status,
        duration,
        responseData: responseData as any,
      },
    })
  }

  private mapMarketplaceOrderStatus(marketStatus: string): string {
    const map: Record<string, string> = {
      // Falabella
      pending: 'pending',
      ready_to_ship: 'confirmed',
      readytoship: 'confirmed',
      shipped: 'fulfilled',
      delivered: 'completed',
      canceled: 'cancelled',
      failed: 'cancelled',
      returned: 'cancelled',
      // MercadoLibre
      payment_required: 'pending',
      payment_in_process: 'pending',
      paid: 'confirmed',
      partially_refunded: 'confirmed',
      cancelled: 'cancelled',
      invalid: 'cancelled',
    }
    return map[marketStatus?.toLowerCase()] || 'pending'
  }

  private mapShipmentStatus(marketStatus: string): string {
    const map: Record<string, string> = {
      pending: 'pending',
      ready_to_ship: 'pending',
      readytoship: 'pending',
      shipped: 'shipped',
      delivered: 'delivered',
      canceled: 'cancelled',
      cancelled: 'cancelled',
      failed: 'cancelled',
      returned: 'returned',
      // ML payment statuses — no shipment yet
      payment_required: 'pending',
      payment_in_process: 'pending',
      paid: 'pending',
    }
    return map[marketStatus?.toLowerCase()] || 'pending'
  }

  private mapPaymentStatus(marketStatus: string): string {
    const paid = ['delivered', 'shipped', 'ready_to_ship', 'readytoship', 'paid', 'partially_refunded']
    const refunded = ['returned']
    const s = marketStatus?.toLowerCase()
    if (paid.includes(s)) return 'paid'
    if (refunded.includes(s)) return 'refunded'
    return 'pending'
  }

  // ─── Sale helpers ─────────────────────────────────────────────────────────

  private async resolveSale(
    tenantId: string,
    source: string,
    marketOrder: import('@stockcentral/integrations').MarketplaceOrder,
  ) {
    if (marketOrder.packId) {
      const existing = await this.prisma.sale.findUnique({
        where: {
          tenantId_source_externalGroupId: {
            tenantId,
            source,
            externalGroupId: marketOrder.packId,
          },
        },
      })
      if (existing) return existing
    }

    return this.createSaleWithRetry(tenantId, {
      source,
      externalGroupId: marketOrder.packId || null,
      customerName: marketOrder.buyerName,
      customerEmail: marketOrder.buyerEmail || null,
      customerPhone: marketOrder.buyerPhone || null,
      customerDocType: marketOrder.buyerDocType || null,
      customerDocNumber: marketOrder.buyerDocNumber || null,
      invoiceType: marketOrder.billing?.invoiceType || 'boleta',
      billingName: marketOrder.billing?.name || null,
      billingDocType: marketOrder.billing?.docType || null,
      billingDocNumber: marketOrder.billing?.docNumber || null,
      billingEmail: marketOrder.billing?.email || null,
      billingPhone: marketOrder.billing?.phone || null,
      economicActivity: marketOrder.billing?.economicActivity || null,
      taxContributor: marketOrder.billing?.taxContributor || null,
      shippingAddress: (marketOrder.shippingAddress as any) ?? undefined,
      billingAddress: (marketOrder.billingAddress as any) ?? undefined,
      currency: marketOrder.currency,
      subtotal: 0,
      shippingCost: 0,
      tax: 0,
      discount: 0,
      total: 0,
      status: 'pending',
      paymentStatus: 'pending',
      shipmentStatus: 'pending',
    })
  }

  // Race-safe Sale create: retries on unique constraint violation by recomputing saleNumber.
  private async createSaleWithRetry(
    tenantId: string,
    data: Omit<import('@prisma/client').Prisma.SaleUncheckedCreateInput, 'tenantId' | 'saleNumber'>,
    attempt = 0,
  ): Promise<import('@prisma/client').Sale> {
    const saleNumber = await this.nextSaleNumber(tenantId)
    try {
      return await this.prisma.sale.create({
        data: { ...data, tenantId, saleNumber },
      })
    } catch (err: any) {
      const isUniqueViolation = err?.code === 'P2002'
      if (isUniqueViolation && attempt < 10) {
        return this.createSaleWithRetry(tenantId, data, attempt + 1)
      }
      throw err
    }
  }

  private async nextSaleNumber(tenantId: string): Promise<string> {
    // Sort lexicographically — works because saleNumber is zero-padded ('SALE-000001').
    const last = await this.prisma.sale.findFirst({
      where: { tenantId, saleNumber: { startsWith: 'SALE-' } },
      orderBy: { saleNumber: 'desc' },
      select: { saleNumber: true },
    })
    const lastNum = last ? parseInt(last.saleNumber.replace(/\D/g, ''), 10) || 0 : 0
    return `SALE-${String(lastNum + 1).padStart(6, '0')}`
  }

  private async recalculateSale(saleId: string) {
    const orders = await this.prisma.order.findMany({
      where: { saleId },
      orderBy: { createdAt: 'asc' },
    })

    if (orders.length === 0) return

    const sum = (key: 'subtotal' | 'shippingCost' | 'tax' | 'discount' | 'total') =>
      orders.reduce((acc, o) => acc + Number(o[key] || 0), 0)

    // Pick the first order with a real customer name as the canonical source
    // for customer/billing fields on the Sale.
    const canonical = orders.find((o) => o.customerName && o.customerName !== 'Unknown') || orders[0]

    await this.prisma.sale.update({
      where: { id: saleId },
      data: {
        subtotal: sum('subtotal'),
        shippingCost: sum('shippingCost'),
        tax: sum('tax'),
        discount: sum('discount'),
        total: sum('total'),
        status: this.aggregateStatus(orders.map((o) => o.status)),
        paymentStatus: this.aggregateStatus(orders.map((o) => o.paymentStatus)),
        shipmentStatus: this.aggregateStatus(orders.map((o) => o.shipmentStatus)),
        customerName: canonical.customerName,
        customerEmail: canonical.customerEmail,
        customerPhone: canonical.customerPhone,
        customerDocType: canonical.customerDocType,
        customerDocNumber: canonical.customerDocNumber,
        invoiceType: canonical.invoiceType || 'boleta',
        billingName: canonical.billingName,
        billingDocType: canonical.billingDocType,
        billingDocNumber: canonical.billingDocNumber,
        billingEmail: canonical.billingEmail,
        billingPhone: canonical.billingPhone,
        economicActivity: canonical.economicActivity,
        taxContributor: canonical.taxContributor,
        shippingAddress: (canonical.shippingAddress as any) ?? undefined,
        billingAddress: (canonical.billingAddress as any) ?? undefined,
      },
    })
  }

  private async cleanupSaleIfEmpty(saleId: string) {
    const remaining = await this.prisma.order.count({ where: { saleId } })
    if (remaining === 0) {
      await this.prisma.sale.delete({ where: { id: saleId } }).catch(() => undefined)
    } else {
      await this.recalculateSale(saleId)
    }
  }

  private aggregateStatus(statuses: string[]): string {
    if (statuses.length === 0) return 'pending'
    const unique = Array.from(new Set(statuses))
    if (unique.length === 1) return unique[0]
    if (unique.every((s) => s === 'cancelled')) return 'cancelled'
    if (unique.includes('pending')) return 'pending'
    return unique[0]
  }
}
