import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bull'
import { Cron, CronExpression } from '@nestjs/schedule'
import { Queue } from 'bull'
import { PrismaService } from '../../prisma/prisma.service'
import { getDriver } from '@stockcentral/integrations'
import { SYNC_QUEUE, SyncJobType } from './sync.constants'
import { BillingListener } from '../billing/billing.listener'

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name)

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(SYNC_QUEUE) private readonly syncQueue: Queue,
    private readonly billing: BillingListener,
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

  // Refresca tokens OAuth ANTES de que expiren. ML emite tokens con vida 6h
  // y refresh_tokens; si no se renuevan, el sync empieza a fallar con 401
  // silenciosamente. Corremos cada 30min y refrescamos cualquier token que
  // expire en menos de 1h.
  @Cron(CronExpression.EVERY_30_MINUTES)
  async scheduledRefreshOAuthTokens() {
    const connections = await this.prisma.connection.findMany({
      where: { syncEnabled: true },
      select: { id: true, tenantId: true, provider: true, config: true },
    })
    const now = Date.now()
    const oneHourMs = 60 * 60 * 1000
    for (const conn of connections) {
      const cfg = (conn.config as any) || {}
      const expiresAtRaw = cfg?.tokenExpiresAt
      if (!expiresAtRaw) continue
      const expiresAt = new Date(expiresAtRaw).getTime()
      if (Number.isNaN(expiresAt)) continue
      if (expiresAt - now > oneHourMs) continue
      try {
        const driver = getDriver(conn.provider)
        if (!driver.refreshToken) continue
      } catch {
        continue
      }
      try {
        await this.refreshOAuthToken(conn.tenantId, conn.id)
        this.logger.log(`OAuth token refreshed for ${conn.provider} (${conn.id})`)
      } catch (err: any) {
        this.logger.error(
          `OAuth refresh failed for ${conn.provider} (${conn.id}): ${err?.message || err}`,
        )
      }
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async scheduledOrdersInbound() {
    const connections = await this.prisma.connection.findMany({
      where: { syncEnabled: true, status: 'connected' },
      select: { id: true, tenantId: true, provider: true, lastSync: true },
    })

    for (const conn of connections) {
      // Skip providers whose driver opts out of write sync (read-only catalog
      // sources like EYLSTORE that don't expose orders).
      try {
        const driver = getDriver(conn.provider)
        if (driver.supportsWriteSync === false) continue
      } catch {
        continue
      }
      await this.enqueueOrdersInbound(conn.tenantId, conn.id, conn.lastSync || undefined)
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async scheduledProductsOutbound() {
    const connections = await this.prisma.connection.findMany({
      where: { syncEnabled: true, status: 'connected' },
      select: { id: true, tenantId: true, provider: true },
    })

    for (const conn of connections) {
      // Skip providers whose driver explicitly opts out of write sync
      // (read-only upstream APIs like EYLSTORE).
      try {
        const driver = getDriver(conn.provider)
        if (driver.supportsWriteSync === false) continue
      } catch {
        // Unknown provider → skip rather than crash the cron tick.
        continue
      }
      await this.enqueueProductsOutbound(conn.tenantId, conn.id)
    }
  }

  // ─── Real Sync Logic ──────────────────────────────────────────────────────

  async syncProductsOutbound(tenantId: string, connectionId: string, productIds?: string[]) {
    const connection = await this.getConnection(tenantId, connectionId)
    const driver = getDriver(connection.provider)

    // Read-only drivers (catalog sources like EYLSTORE) don't expose write APIs.
    // Returning early prevents 'NOT_IMPLEMENTED' errors from each mapped product
    // tripping the circuit breaker and auto-disabling the connection.
    if (driver.supportsWriteSync === false) {
      this.logger.log(`Skipping outbound product sync for read-only provider: ${connection.provider}`)
      return { synced: 0, errors: 0, suspiciousSkipped: 0, circuitTripped: false, total: 0, skipped: true }
    }

    const credentials = connection.credentials as Record<string, string>
    const config = connection.config as Record<string, unknown> | undefined

    const whereClause: any = { tenantId, status: 'active' }
    if (productIds?.length) whereClause.id = { in: productIds }

    const products = await this.prisma.product.findMany({
      where: whereClause,
      include: {
        // Sync to marketplaces uses online + store stock (no internal warehouses)
        inventory: {
          where: { variantId: null, warehouse: { warehouseType: { in: ['online', 'store'] } } },
        },
        marketplaceMappings: { where: { connectionId } },
      },
    })

    let synced = 0
    let errors = 0
    let suspiciousSkipped = 0
    const startTime = Date.now()

    // Circuit breaker: if too many requests fail, stop the run AND disable
    // syncEnabled to protect the marketplace account from getting flagged.
    const ERROR_THRESHOLD = 10
    let consecutiveErrors = 0
    let circuitTripped = false

    for (const product of products) {
      if (circuitTripped) break
      const mapping = product.marketplaceMappings[0]
      // Skip products that are NOT yet published in this marketplace.
      // Creating a listing requires explicit user action (form with category,
      // attributes, etc.). The cron only updates existing publications.
      if (!mapping?.marketplaceProductId) continue

      // Sanity check: if the mapping's marketplaceProductId equals the master
      // SKU, it's almost certainly a corrupted mapping from a failed create
      // (the create errored but the externalId got persisted as the local sku).
      // Sending updateProduct with that "id" makes the marketplace treat it as
      // a brand-new create, which spams their backoffice. Skip and flag.
      if (mapping.marketplaceProductId === product.sku) {
        await this.updateMappingError(
          product.id,
          connectionId,
          'Mapping sospechoso: marketplaceProductId coincide con el SKU local. Republica manualmente.',
        )
        suspiciousSkipped++
        continue
      }

      const stock = product.inventory.reduce((s, i) => s + i.quantity, 0)
      const syncInput = {
        sku: product.sku,
        title: product.name,
        description: product.description || undefined,
        price: Number(product.basePrice),
        stock,
        images: (product.images as string[] | null) || [],
      }

      try {
        const result = await driver.updateProduct(credentials, mapping.marketplaceProductId, syncInput, config)

        if (result.success) {
          consecutiveErrors = 0
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
          consecutiveErrors++
        }
      } catch (err: any) {
        await this.updateMappingError(product.id, connectionId, err.message)
        errors++
        consecutiveErrors++
      }

      if (consecutiveErrors >= ERROR_THRESHOLD) {
        circuitTripped = true
        this.logger.error(
          `Circuit breaker tripped for connection ${connectionId} (${connection.provider}) after ${consecutiveErrors} consecutive errors. Auto-disabling syncEnabled.`,
        )
        await this.prisma.connection.update({
          where: { id: connectionId },
          data: {
            syncEnabled: false,
            lastError: `Auto-desactivado: ${consecutiveErrors} errores consecutivos en sync. Revisa la conexión y reactivar manualmente.`,
          },
        })
      }
    }

    const duration = Date.now() - startTime
    await this.logSync(tenantId, connectionId, 'outbound', 'sync_products', 'product', null, synced > 0 ? 'success' : 'error', duration, { synced, errors, suspiciousSkipped, circuitTripped, total: products.length })
    await this.prisma.connection.update({
      where: { id: connectionId },
      data: { lastSync: new Date(), status: circuitTripped ? 'error' : 'connected' },
    })

    return { synced, errors, suspiciousSkipped, circuitTripped, total: products.length }
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

    // Registrar callback de auto-refresh para drivers que lo soportan
    // (hoy: MercadoLibre). Si el driver responde 401, refresca el token y
    // reintenta. dispose() se llama al final para no contaminar otros flujos.
    const dispose = this.attachRefreshHandler(driver, tenantId, connectionId)

    let offset = 0
    const limit = 50
    let created = 0
    let errors = 0
    const startTime = Date.now()

    try {
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
            const prevPaymentStatus = existing.paymentStatus
            const prevInternalStatus = existing.internalStatus
            // Si el internalStatus ya fue cancelado manualmente (cancelled_internal),
            // o ya está en ready_to_ship, no lo retrocedemos al re-syncear; solo
            // permitimos avances naturales o cancelación desde el marketplace.
            const candidateInternal = this.mapInternalStatus(marketOrder.status)
            const nextInternalStatus =
              prevInternalStatus === 'cancelled_internal'
                ? 'cancelled_internal'
                : candidateInternal
            const nextPaymentStatus = this.mapPaymentStatus(marketOrder.status)
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
                paymentStatus: nextPaymentStatus,
                shipmentStatus: this.mapShipmentStatus(marketOrder.status),
                internalStatus: nextInternalStatus,
                // Solo seteamos placedAt si la orden no lo tiene aún. La fecha
                // del marketplace no debería cambiar en updates futuros.
                placedAt: existing.placedAt ?? marketOrder.createdAt,
              },
            })
            await this.recalculateSale(targetSaleId)
            if (previousSaleId && previousSaleId !== targetSaleId) {
              await this.cleanupSaleIfEmpty(previousSaleId)
            }
            await this.billing.onOrderTransition({
              tenantId,
              orderId: existing.id,
              saleId: targetSaleId,
              prev: { paymentStatus: prevPaymentStatus, internalStatus: prevInternalStatus },
              next: { paymentStatus: nextPaymentStatus, internalStatus: nextInternalStatus },
            })
            continue
          }

          const orderNumber = `${connection.provider.toUpperCase()}-${marketOrder.externalOrderNumber || marketOrder.externalId}`
          const sale = await this.resolveSale(tenantId, connection.provider, marketOrder)
          const initialPaymentStatus = this.mapPaymentStatus(marketOrder.status)
          const initialInternalStatus = this.mapInternalStatus(marketOrder.status)

          const newOrder = await this.prisma.order.create({
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
              paymentStatus: initialPaymentStatus,
              shipmentStatus: this.mapShipmentStatus(marketOrder.status),
              internalStatus: initialInternalStatus,
              // Fecha real en que el pedido se creó en el marketplace.
              placedAt: marketOrder.createdAt,
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
          await this.billing.onOrderTransition({
            tenantId,
            orderId: newOrder.id,
            saleId: sale.id,
            // Para órdenes nuevas: previo es "pending/new" (default Prisma).
            // Si el marketplace ya entrega la orden pagada, esto dispara la
            // emisión inmediatamente.
            prev: { paymentStatus: 'pending', internalStatus: 'new' },
            next: {
              paymentStatus: initialPaymentStatus,
              internalStatus: initialInternalStatus,
            },
          })
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
    } finally {
      dispose()
    }
  }

  // Si el driver soporta callback de auto-refresh (hoy solo el de ML),
  // registra una función que refresca el token usando los métodos del propio
  // driver y persiste los nuevos credentials en DB. Devuelve dispose() para
  // limpiar el handler al final del flujo.
  private attachRefreshHandler(
    driver: any,
    tenantId: string,
    connectionId: string,
  ): () => void {
    if (typeof driver.setRefreshHandler !== 'function') return () => {}
    return driver.setRefreshHandler(async () => {
      this.logger.warn(
        `[${driver.provider}] 401 detectado — refrescando token (connection ${connectionId})`,
      )
      // refreshOAuthToken lee la connection actual, llama al refreshToken
      // del driver y persiste credentials + tokenExpiresAt.
      await this.refreshOAuthToken(tenantId, connectionId)
      const updated = await this.prisma.connection.findUnique({
        where: { id: connectionId },
        select: { credentials: true },
      })
      const accessToken = (updated?.credentials as any)?.accessToken
      if (!accessToken) {
        throw new Error('Refresh OK pero no hay accessToken nuevo en DB')
      }
      return { accessToken }
    })
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
    const config = (connection.config as Record<string, unknown> | undefined) || {}

    if (!driver.refreshToken || !credentials.refreshToken) return

    const tokens = await driver.refreshToken(credentials.refreshToken, config)
    const updatedCredentials = {
      ...credentials,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken || credentials.refreshToken,
    }
    // Persistir tokenExpiresAt para que el cron pueda decidir cuándo
    // renovar la próxima vez.
    const updatedConfig = {
      ...config,
      tokenExpiresAt: tokens.expiresAt
        ? tokens.expiresAt.toISOString()
        : (config as any).tokenExpiresAt,
    }

    await this.prisma.connection.update({
      where: { id: connectionId },
      data: {
        credentials: updatedCredentials as any,
        config: updatedConfig as any,
      },
    })
  }

  // ─── Manual Trigger (from controller) ─────────────────────────────────────

  async triggerFullSync(tenantId: string, connectionId: string) {
    const connection = await this.getConnection(tenantId, connectionId)

    let isReadOnly = false
    try {
      const driver = getDriver(connection.provider)
      isReadOnly = driver.supportsWriteSync === false
    } catch {
      // Unknown provider: fall through and try all jobs.
    }

    // For read-only catalog sources (EYLSTORE) there's nothing to push out
    // and no orders to fetch — only the inbound product sync makes sense.
    const jobs: Promise<any>[] = isReadOnly
      ? [this.enqueueProductsInbound(tenantId, connectionId)]
      : [
          this.enqueueOrdersInbound(tenantId, connectionId),
          this.enqueueProductsInbound(tenantId, connectionId),
          this.enqueueProductsOutbound(tenantId, connectionId),
        ]

    const results = await Promise.all(jobs)
    return {
      message: 'Sincronización encolada',
      jobs: isReadOnly
        ? { productsIn: results[0].id }
        : { orders: results[0].id, productsIn: results[1].id, productsOut: results[2].id },
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
    // Cancelaciones del marketplace deben quedar como `cancelled`, no como
    // `pending`. Antes una orden cancelada caía en "Por facturar" porque
    // /pending/ era el catch-all del default.
    const cancelled = ['cancelled', 'canceled', 'failed', 'invalid']
    const s = marketStatus?.toLowerCase()
    if (paid.includes(s)) return 'paid'
    if (refunded.includes(s)) return 'refunded'
    if (cancelled.includes(s)) return 'cancelled'
    return 'pending'
  }

  // Flujo interno de fulfillment, derivado del estado del marketplace.
  // Es el campo que el operador ve en el portal; el `status` real del canal
  // queda como informativo y nunca se modifica desde la UI.
  private mapInternalStatus(marketStatus: string): string {
    const s = marketStatus?.toLowerCase()
    const cancelled = ['cancelled', 'canceled', 'failed', 'returned', 'invalid']
    const ready = ['shipped', 'fulfilled', 'delivered', 'completed']
    const inPrep = ['paid', 'confirmed', 'ready_to_ship', 'readytoship', 'acknowledged', 'partially_refunded']
    if (cancelled.includes(s)) return 'cancelled_internal'
    if (ready.includes(s)) return 'ready_to_ship'
    if (inPrep.includes(s)) return 'in_preparation'
    return 'new'
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

    // Sale.placedAt = la fecha real más temprana de sus orders.
    // Si ninguna order tiene placedAt aún (legacy), dejamos null y caemos a
    // createdAt en la UI.
    const placedAtCandidates = orders
      .map((o) => o.placedAt)
      .filter((d): d is Date => !!d)
    const earliestPlacedAt = placedAtCandidates.length > 0
      ? new Date(Math.min(...placedAtCandidates.map((d) => d.getTime())))
      : null

    await this.prisma.sale.update({
      where: { id: saleId },
      data: {
        subtotal: sum('subtotal'),
        shippingCost: sum('shippingCost'),
        tax: sum('tax'),
        discount: sum('discount'),
        total: sum('total'),
        placedAt: earliestPlacedAt,
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

  // ── Audit: detect bogus marketplace mappings ──────────────────────────────
  // A "suspicious" mapping is one whose marketplaceProductId equals the master
  // SKU — that's the corruption pattern we saw with Lider, where a failed
  // create persisted the local sku as if it were a real marketplace ID.
  // Catalog source providers (eylstore/shopify/etc.) are excluded because
  // for them the marketplaceProductId == sku is legitimate.
  async auditMappings(tenantId: string) {
    const connections = await this.prisma.connection.findMany({
      where: { tenantId },
      select: { id: true, name: true, provider: true, isCatalogSource: true },
    })
    const liveMarketIds = connections
      .filter((c) => !c.isCatalogSource)
      .map((c) => c.id)

    const mappings = await this.prisma.marketplaceMapping.findMany({
      where: { connectionId: { in: liveMarketIds } },
      include: {
        product: { select: { sku: true, name: true } },
        connection: { select: { provider: true, name: true } },
      },
    })

    const suspicious = mappings.filter(
      (m) => m.marketplaceProductId && m.marketplaceProductId === m.product.sku,
    )
    const erroredWithoutId = mappings.filter(
      (m) => m.syncStatus === 'error' && !m.marketplaceProductId,
    )

    return {
      summary: {
        totalAuditedMappings: mappings.length,
        suspiciousFound: suspicious.length,
        erroredWithoutIdFound: erroredWithoutId.length,
      },
      suspicious: suspicious.map((m) => ({
        mappingId: m.id,
        productSku: m.product.sku,
        productName: m.product.name,
        provider: m.connection.provider,
        connectionName: m.connection.name,
        marketplaceProductId: m.marketplaceProductId,
        syncStatus: m.syncStatus,
        errorMessage: m.errorMessage,
      })),
      erroredWithoutId: erroredWithoutId.map((m) => ({
        mappingId: m.id,
        productSku: m.product.sku,
        productName: m.product.name,
        provider: m.connection.provider,
        connectionName: m.connection.name,
        errorMessage: m.errorMessage,
      })),
    }
  }

  // Delete the bogus mappings detected by auditMappings.
  async cleanupBogusMappings(tenantId: string) {
    const connections = await this.prisma.connection.findMany({
      where: { tenantId, isCatalogSource: false },
      select: { id: true },
    })
    const liveMarketIds = connections.map((c) => c.id)

    // Find suspicious by reading + matching (Prisma cannot compare two columns
    // in a single query without raw SQL — and we want to keep the operation
    // readable).
    const all = await this.prisma.marketplaceMapping.findMany({
      where: { connectionId: { in: liveMarketIds } },
      include: { product: { select: { sku: true } } },
    })
    const suspiciousIds = all
      .filter((m) => m.marketplaceProductId && m.marketplaceProductId === m.product.sku)
      .map((m) => m.id)
    const erroredEmptyIds = all
      .filter((m) => m.syncStatus === 'error' && !m.marketplaceProductId)
      .map((m) => m.id)

    const toDelete = [...new Set([...suspiciousIds, ...erroredEmptyIds])]
    if (!toDelete.length) return { deleted: 0 }

    const result = await this.prisma.marketplaceMapping.deleteMany({
      where: { id: { in: toDelete } },
    })
    this.logger.log(`Cleaned up ${result.count} bogus mappings for tenant ${tenantId}`)
    return { deleted: result.count }
  }
}
