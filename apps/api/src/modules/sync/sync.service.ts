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

  @Cron(CronExpression.EVERY_30_MINUTES)
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
          if (existing) continue

          const orderNumber = `${connection.provider.toUpperCase()}-${marketOrder.externalOrderNumber || marketOrder.externalId}`

          await this.prisma.order.create({
            data: {
              tenantId,
              orderNumber,
              source: connection.provider,
              sourceChannel: connection.name,
              externalOrderId: marketOrder.externalId,
              customerName: marketOrder.buyerName,
              customerEmail: marketOrder.buyerEmail || null,
              customerPhone: marketOrder.buyerPhone || null,
              subtotal: marketOrder.subtotal,
              shippingCost: marketOrder.shippingCost,
              tax: 0,
              discount: 0,
              total: marketOrder.total,
              currency: marketOrder.currency,
              status: 'pending',
              paymentStatus: 'pending',
              shipmentStatus: 'pending',
              shippingAddress: marketOrder.shippingAddress as any,
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
    const [ordersJob, productsJob] = await Promise.all([
      this.enqueueOrdersInbound(tenantId, connectionId),
      this.enqueueProductsOutbound(tenantId, connectionId),
    ])
    return {
      message: 'Sincronización encolada',
      jobs: { orders: ordersJob.id, products: productsJob.id },
    }
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
}
