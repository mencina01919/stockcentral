import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../../prisma/prisma.service'
import { getDriver } from '@stockcentral/integrations'

// Generic catalog source service. Works for ANY connection whose driver
// declares `catalogCapabilities.canBeCatalogSource = true`. No provider-specific
// logic lives here — that's the point.

export interface ImportStats {
  scanned: number
  created: number
  updated: number
  unchanged: number
  errors: number
  errorDetails: { sku?: string; externalId?: string; error: string }[]
}

@Injectable()
export class CatalogSourceService {
  private readonly logger = new Logger(CatalogSourceService.name)

  constructor(private prisma: PrismaService) {}

  // ── Selection ────────────────────────────────────────────────────────────

  // List the connections of this tenant that COULD be catalog sources
  // (driver declares canBeCatalogSource), plus which one is currently set.
  async listCandidates(tenantId: string) {
    const connections = await this.prisma.connection.findMany({
      where: { tenantId, status: 'connected' },
      orderBy: { createdAt: 'asc' },
    })
    return connections
      .map((conn) => {
        let caps
        try {
          caps = getDriver(conn.provider).catalogCapabilities
        } catch {
          caps = undefined
        }
        return {
          id: conn.id,
          name: conn.name,
          provider: conn.provider,
          isCatalogSource: conn.isCatalogSource,
          catalogConfig: conn.catalogConfig,
          lastCatalogSyncAt: conn.lastCatalogSyncAt,
          lastCatalogSyncStats: conn.lastCatalogSyncStats,
          capabilities: caps,
          eligible: !!caps?.canBeCatalogSource,
        }
      })
      .filter((c) => c.eligible || c.isCatalogSource)
  }

  async getActive(tenantId: string) {
    return this.prisma.connection.findFirst({
      where: { tenantId, isCatalogSource: true },
    })
  }

  async setSource(
    tenantId: string,
    connectionId: string,
    catalogConfig?: Record<string, unknown>,
  ) {
    const conn = await this.prisma.connection.findFirst({
      where: { id: connectionId, tenantId },
    })
    if (!conn) throw new NotFoundException('Conexión no encontrada')

    let caps
    try {
      caps = getDriver(conn.provider).catalogCapabilities
    } catch {
      caps = undefined
    }
    if (!caps?.canBeCatalogSource) {
      throw new BadRequestException(
        `El proveedor "${conn.provider}" no puede ser fuente del catálogo maestro.`,
      )
    }

    // The partial unique index in the DB enforces "max 1 per tenant".
    // We unset others first to keep the transaction predictable across DBs.
    await this.prisma.$transaction([
      this.prisma.connection.updateMany({
        where: { tenantId, isCatalogSource: true, NOT: { id: connectionId } },
        data: { isCatalogSource: false },
      }),
      this.prisma.connection.update({
        where: { id: connectionId },
        data: {
          isCatalogSource: true,
          catalogConfig: (catalogConfig ?? conn.catalogConfig ?? {}) as any,
        },
      }),
    ])
    return { ok: true }
  }

  async clearSource(tenantId: string) {
    await this.prisma.connection.updateMany({
      where: { tenantId, isCatalogSource: true },
      data: { isCatalogSource: false },
    })
    return { ok: true }
  }

  async updateConfig(tenantId: string, catalogConfig: Record<string, unknown>) {
    const conn = await this.getActive(tenantId)
    if (!conn) throw new NotFoundException('No hay fuente del catálogo configurada')
    await this.prisma.connection.update({
      where: { id: conn.id },
      data: { catalogConfig: catalogConfig as any },
    })
    return { ok: true }
  }

  // ── Import / Sync ────────────────────────────────────────────────────────

  // Pulls every product from the configured source, creating Products that
  // don't exist locally and (optionally) refreshing existing ones.
  async runImport(tenantId: string, options: { syncProducts?: boolean; syncStock?: boolean } = {}) {
    const conn = await this.getActive(tenantId)
    if (!conn) throw new BadRequestException('No hay fuente del catálogo configurada')

    const driver = getDriver(conn.provider)
    if (!driver.catalogCapabilities?.canBeCatalogSource) {
      throw new BadRequestException(`El driver "${conn.provider}" perdió la capacidad de ser fuente`)
    }

    // Default warehouse (or first one) — Inventory rows live in a warehouse.
    const warehouse =
      (await this.prisma.warehouse.findFirst({
        where: { tenantId, isDefault: true, active: true },
      })) ||
      (await this.prisma.warehouse.findFirst({
        where: { tenantId, active: true },
        orderBy: { createdAt: 'asc' },
      }))
    if (!warehouse) {
      throw new BadRequestException(
        'No hay bodegas activas. Crea una bodega antes de importar productos.',
      )
    }

    const stats: ImportStats = {
      scanned: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      errors: 0,
      errorDetails: [],
    }

    const credentials = conn.credentials as Record<string, string>
    const config = (conn.config as Record<string, unknown> | undefined) ?? undefined
    const cfg = (conn.catalogConfig as Record<string, unknown> | undefined) ?? {}
    const shouldSyncProducts: boolean =
      options.syncProducts ?? (typeof cfg.autoSyncProducts === 'boolean' ? cfg.autoSyncProducts : true)
    const shouldSyncStock: boolean =
      options.syncStock ?? (typeof cfg.autoSyncStock === 'boolean' ? cfg.autoSyncStock : true)

    let offset = 0
    const pageSize = 50

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const page = await driver.getProducts(credentials, config, offset, pageSize)
      if (!page.items.length) break

      for (const remote of page.items) {
        stats.scanned++
        try {
          await this.upsertProductFromRemote(tenantId, conn.id, warehouse.id, remote, {
            syncProducts: shouldSyncProducts,
            syncStock: shouldSyncStock,
            stats,
          })
        } catch (err: any) {
          stats.errors++
          stats.errorDetails.push({
            sku: remote.externalSku,
            externalId: remote.externalId,
            error: err?.message || String(err),
          })
        }
      }

      offset += page.items.length
      if (!page.hasMore) break
      // Safety brake: stop after 5000 to avoid runaway imports.
      if (offset >= 5000) break
    }

    await this.prisma.connection.update({
      where: { id: conn.id },
      data: {
        lastCatalogSyncAt: new Date(),
        lastCatalogSyncStats: stats as unknown as any,
      },
    })

    this.logger.log(
      `Catalog import [${conn.provider}] tenant=${tenantId} scanned=${stats.scanned} created=${stats.created} updated=${stats.updated} unchanged=${stats.unchanged} errors=${stats.errors}`,
    )
    return stats
  }

  // Cheap variant: only refresh stock, no product mutations.
  async runStockSync(tenantId: string) {
    return this.runImport(tenantId, { syncProducts: false, syncStock: true })
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async upsertProductFromRemote(
    tenantId: string,
    connectionId: string,
    warehouseId: string,
    remote: any,
    opts: { syncProducts: boolean; syncStock: boolean; stats: ImportStats },
  ) {
    const sku = remote.externalSku || remote.externalId
    if (!sku) throw new Error('producto remoto sin sku ni externalId')

    // Match by mapping first (most reliable), fall back to SKU.
    const existingMapping = await this.prisma.marketplaceMapping.findFirst({
      where: { connectionId, marketplaceProductId: remote.externalId },
      include: { product: true },
    })

    let product = existingMapping?.product || null
    if (!product) {
      product = await this.prisma.product.findUnique({
        where: { tenantId_sku: { tenantId, sku } },
      })
    }

    const productData = {
      name: remote.title || sku,
      description: remote.description || null,
      basePrice: remote.price || 0,
      images: remote.images || [],
    }

    if (!product) {
      product = await this.prisma.product.create({
        data: {
          tenantId,
          sku,
          status: 'active',
          ...productData,
        },
      })
      opts.stats.created++
    } else if (opts.syncProducts) {
      // Only overwrite the fields that are safe to overwrite from the source.
      // Catalog source is authoritative for name/description/basePrice/images;
      // marketplace-specific data lives elsewhere.
      const before = {
        name: product.name,
        description: product.description,
        basePrice: String(product.basePrice),
        images: JSON.stringify(product.images),
      }
      const after = {
        name: productData.name,
        description: productData.description,
        basePrice: String(productData.basePrice),
        images: JSON.stringify(productData.images),
      }
      const changed =
        before.name !== after.name ||
        before.description !== after.description ||
        before.basePrice !== after.basePrice ||
        before.images !== after.images
      if (changed) {
        product = await this.prisma.product.update({
          where: { id: product.id },
          data: productData,
        })
        opts.stats.updated++
      } else {
        opts.stats.unchanged++
      }
    } else {
      opts.stats.unchanged++
    }

    // Stock — Inventory has a composite unique on (productId, variantId, warehouseId)
    // but Prisma cannot use null in compound unique keys, so we manually find+update.
    if (opts.syncStock) {
      const existing = await this.prisma.inventory.findFirst({
        where: { productId: product.id, variantId: null, warehouseId },
      })
      const qty = remote.stock ?? 0
      if (existing) {
        await this.prisma.inventory.update({
          where: { id: existing.id },
          data: { quantity: qty },
        })
      } else {
        await this.prisma.inventory.create({
          data: { tenantId, productId: product.id, warehouseId, quantity: qty },
        })
      }
    }

    // Mapping — keep the link to the source connection.
    if (!existingMapping) {
      await this.prisma.marketplaceMapping.upsert({
        where: { productId_connectionId: { productId: product.id, connectionId } },
        create: {
          productId: product.id,
          connectionId,
          marketplaceProductId: remote.externalId,
          marketplaceSku: remote.externalSku,
          syncStatus: 'connected',
          lastSyncAt: new Date(),
        },
        update: {
          marketplaceProductId: remote.externalId,
          marketplaceSku: remote.externalSku,
          syncStatus: 'connected',
          lastSyncAt: new Date(),
        },
      })
    }
  }

  // ── Cron: stock sync for tenants that opted in ───────────────────────────

  @Cron(CronExpression.EVERY_5_MINUTES)
  async scheduledStockSync() {
    const sources = await this.prisma.connection.findMany({
      where: { isCatalogSource: true, syncEnabled: true, status: 'connected' },
      select: { id: true, tenantId: true, catalogConfig: true, provider: true },
    })

    for (const src of sources) {
      const cfg = (src.catalogConfig as Record<string, unknown> | undefined) ?? {}
      if (cfg.autoSyncStock === false) continue
      try {
        await this.runStockSync(src.tenantId)
      } catch (err: any) {
        this.logger.error(`scheduledStockSync failed for ${src.provider}: ${err.message}`)
      }
    }
  }
}
