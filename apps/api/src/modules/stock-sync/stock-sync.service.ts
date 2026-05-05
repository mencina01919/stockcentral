import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { getDriver } from '@stockcentral/integrations'
import { computeMatchScore } from './stock-sync.matcher'

export interface SyncRecommendation {
  masterProduct: { id: string; name: string; sku: string; stock: number }
  marketProduct: { externalId: string; title: string; externalSku: string; stock: number; url?: string }
  match: ReturnType<typeof computeMatchScore>
  existingMapping: boolean
  connectionId: string
  provider: string
}

@Injectable()
export class StockSyncService {
  private readonly logger = new Logger(StockSyncService.name)

  constructor(private prisma: PrismaService) {}

  async getRecommendations(tenantId: string, connectionId: string): Promise<SyncRecommendation[]> {
    const connection = await this.prisma.connection.findFirst({
      where: { id: connectionId, tenantId },
    })
    if (!connection) throw new NotFoundException('Conexión no encontrada')
    if (connection.status !== 'connected') {
      throw new BadRequestException('La conexión no está activa')
    }

    const driver = getDriver(connection.provider)
    const credentials = connection.credentials as Record<string, any>
    const config = (connection.config ?? {}) as Record<string, any>

    const [masterProducts, existingMappings] = await Promise.all([
      this.prisma.product.findMany({
        where: { tenantId, status: { not: 'unavailable' } },
        include: {
          inventory: { where: { warehouse: { warehouseType: 'online' } } },
        },
      }),
      this.prisma.marketplaceMapping.findMany({
        where: { connection: { tenantId }, connectionId },
        select: { productId: true, marketplaceProductId: true, marketplaceSku: true },
      }),
    ])

    const mappedProductIds = new Set(existingMappings.map((m) => m.productId))

    // Fetch all marketplace products (paginated, max 500 for perf)
    let marketProducts: Array<{ externalId: string; externalSku?: string; title: string; stock: number; url?: string }> = []
    try {
      const page1 = await driver.getProducts(credentials, config, 0, 100)
      marketProducts = page1.items.map((p) => ({
        externalId: p.externalId,
        externalSku: p.externalSku ?? '',
        title: p.title,
        stock: p.stock,
        url: p.url,
      }))

      if (page1.hasMore && page1.total <= 500) {
        const pages = Math.ceil(Math.min(page1.total, 500) / 100)
        for (let i = 1; i < pages; i++) {
          const page = await driver.getProducts(credentials, config, i * 100, 100)
          marketProducts.push(...page.items.map((p) => ({ externalId: p.externalId, externalSku: p.externalSku ?? '', title: p.title, stock: p.stock, url: p.url })))
        }
      }
    } catch (err: any) {
      this.logger.error(`Failed to fetch products from ${connection.provider}: ${err.message}`)
      throw new BadRequestException(`No se pudieron obtener productos del marketplace: ${err.message}`)
    }

    const recommendations: SyncRecommendation[] = []

    for (const master of masterProducts) {
      const masterStock = master.inventory.reduce((s, i) => s + i.quantity, 0)

      for (const market of marketProducts) {
        const matchScore = computeMatchScore(master.name, master.sku, market.title, market.externalSku ?? '')

        // Only surface recommendations with medium+ confidence
        if (matchScore.score < 40) continue

        // Skip if already exactly mapped
        const alreadyMapped = existingMappings.some(
          (m) => m.productId === master.id && m.marketplaceProductId === market.externalId,
        )

        recommendations.push({
          masterProduct: { id: master.id, name: master.name, sku: master.sku, stock: masterStock },
          marketProduct: { externalId: market.externalId, title: market.title, externalSku: market.externalSku ?? '', stock: market.stock, url: market.url },
          match: matchScore,
          existingMapping: alreadyMapped,
          connectionId,
          provider: connection.provider,
        })
      }
    }

    // Sort by score desc, then prefer unmatched first
    recommendations.sort((a, b) => {
      if (a.existingMapping !== b.existingMapping) return a.existingMapping ? 1 : -1
      return b.match.score - a.match.score
    })

    return recommendations
  }

  async applySync(
    tenantId: string,
    connectionId: string,
    productId: string,
    marketplaceProductId: string,
    marketplaceSku?: string,
  ) {
    const [product, connection] = await Promise.all([
      this.prisma.product.findFirst({
        where: { id: productId, tenantId },
        include: { inventory: { where: { warehouse: { warehouseType: 'online' } } } },
      }),
      this.prisma.connection.findFirst({ where: { id: connectionId, tenantId } }),
    ])

    if (!product) throw new NotFoundException('Producto no encontrado')
    if (!connection) throw new NotFoundException('Conexión no encontrada')

    const driver = getDriver(connection.provider)
    const credentials = connection.credentials as Record<string, any>
    const config = (connection.config ?? {}) as Record<string, any>

    const masterStock = product.inventory.reduce((s, i) => s + i.quantity, 0)

    try {
      await driver.updateStock(credentials, marketplaceProductId, masterStock, config)
    } catch (err: any) {
      throw new BadRequestException(`Error al sincronizar stock: ${err.message}`)
    }

    const mapping = await this.prisma.marketplaceMapping.upsert({
      where: { productId_connectionId: { productId, connectionId } },
      create: {
        productId,
        connectionId,
        marketplaceProductId,
        marketplaceSku: marketplaceSku ?? product.sku,
        syncStatus: 'connected',
        lastSyncAt: new Date(),
      },
      update: {
        marketplaceProductId,
        marketplaceSku: marketplaceSku ?? product.sku,
        syncStatus: 'connected',
        lastSyncAt: new Date(),
        errorMessage: null,
      },
    })

    this.logger.log(`Synced stock ${masterStock} for product ${productId} to ${connection.provider}:${marketplaceProductId}`)
    return { success: true, syncedStock: masterStock, mapping }
  }

  async manualSyncAll(tenantId: string, connectionId: string) {
    const connection = await this.prisma.connection.findFirst({ where: { id: connectionId, tenantId } })
    if (!connection) throw new NotFoundException('Conexión no encontrada')

    const mappings = await this.prisma.marketplaceMapping.findMany({
      where: { connectionId, syncStatus: 'connected', marketplaceProductId: { not: null } },
      include: {
        product: {
          include: { inventory: { where: { warehouse: { warehouseType: 'online' } } } },
        },
      },
    })

    if (mappings.length === 0) return { synced: 0, errors: 0, details: [] }

    const driver = getDriver(connection.provider)
    const credentials = connection.credentials as Record<string, any>
    const config = (connection.config ?? {}) as Record<string, any>

    let synced = 0, errors = 0
    const details: Array<{ productId: string; sku: string; stock: number; success: boolean; error?: string }> = []

    for (const mapping of mappings) {
      const stock = mapping.product.inventory.reduce((s, i) => s + i.quantity, 0)
      try {
        await driver.updateStock(credentials, mapping.marketplaceProductId!, stock, config)
        await this.prisma.marketplaceMapping.update({
          where: { id: mapping.id },
          data: { lastSyncAt: new Date(), errorMessage: null },
        })
        synced++
        details.push({ productId: mapping.productId, sku: mapping.product.sku, stock, success: true })
      } catch (err: any) {
        errors++
        await this.prisma.marketplaceMapping.update({
          where: { id: mapping.id },
          data: { syncStatus: 'error', errorMessage: err.message, lastSyncAt: new Date() },
        })
        details.push({ productId: mapping.productId, sku: mapping.product.sku, stock, success: false, error: err.message })
      }
    }

    return { synced, errors, details }
  }
}
