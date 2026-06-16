import { Injectable, NotFoundException, BadRequestException, Logger, Inject, forwardRef } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../../prisma/prisma.service'
import { getDriver } from '@stockcentral/integrations'
import { InventoryService } from '../inventory/inventory.service'
import { CronMonitorService } from '../sync/cron-monitor.service'

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

  // Guard de solapamiento: el import de catálogos grandes (WonderStore ~15k
  // productos) tarda 13-18 min, más que el intervalo del cron. Sin esto, el
  // siguiente tick arranca otro run encima y quedan runs "running" huérfanos.
  // Set de connectionIds con un import en vuelo.
  private readonly importing = new Set<string>()

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => InventoryService)) private inventoryService: InventoryService,
    private cronMonitor: CronMonitorService,
  ) {}

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
    // Pausa entre páginas si el driver la pide (WonderStore rate-limitea).
    const pageDelayMs = driver.catalogCapabilities?.pageDelayMs ?? 0

    // SKUs que el origen efectivamente devolvió en esta corrida. Al final, los
    // productos publicados que NO estén en este set son candidatos a eliminados
    // del origen (ver bloque de detección de eliminados más abajo).
    const seenSkus = new Set<string>()
    // Si el scan no llegó hasta el final (rompió por error de paginación o por
    // el safety brake), NO podemos confiar en seenSkus para purgar: un import
    // parcial marcaría como "ausentes" productos que sí existen. Solo purgamos
    // cuando el catálogo se recorrió completo.
    let fullScanCompleted = false

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const page = await driver.getProducts(credentials, config, offset, pageSize)
      if (!page.items.length) {
        fullScanCompleted = true
        break
      }

      for (const remote of page.items) {
        stats.scanned++
        const seen = remote.externalSku || remote.externalId
        if (seen) seenSkus.add(String(seen))
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
      if (!page.hasMore) {
        fullScanCompleted = true
        break
      }
      // Safety brake: stop después de 50k para evitar imports descontrolados.
      // WonderStore puede tener catálogos >15k; EYLSTORE ~750.
      if (offset >= 50000) break
      // Respeta el rate-limit del upstream entre páginas.
      if (pageDelayMs > 0) await new Promise((r) => setTimeout(r, pageDelayMs))
    }

    // ── Detección de productos eliminados del origen ─────────────────────────
    // Regla del negocio: si un producto deja de estar en la API del catalog
    // source (el operador lo "saca" del origen), debe quedar en stock 0 en los
    // marketplaces para que no se siga vendiendo algo que ya no existe. El
    // import normal NO lo cubre porque solo actualiza lo que el origen devuelve;
    // un producto borrado simplemente deja de visitarse y su stock queda
    // congelado. Aquí cerramos ese gap.
    if (shouldSyncStock && fullScanCompleted) {
      try {
        const removed = await this.deactivateRemovedProducts(
          tenantId,
          conn.id,
          driver,
          credentials,
          config,
          seenSkus,
        )
        ;(stats as any).removedFromSource = removed
      } catch (err: any) {
        this.logger.error(`deactivateRemovedProducts [${conn.provider}] failed: ${err?.message}`)
      }
    }

    await this.prisma.connection.update({
      where: { id: conn.id },
      data: {
        lastCatalogSyncAt: new Date(),
        lastCatalogSyncStats: stats as unknown as any,
      },
    })

    this.logger.log(
      `Catalog import [${conn.provider}] tenant=${tenantId} scanned=${stats.scanned} created=${stats.created} updated=${stats.updated} unchanged=${stats.unchanged} errors=${stats.errors} removed=${(stats as any).removedFromSource ?? 0}`,
    )
    return stats
  }

  // Pone en stock 0 (y por fan-out, pausa en los marketplaces) los productos
  // publicados desde este catalog source que YA NO aparecieron en la última
  // corrida completa del origen y que se confirman ausentes por findBySku
  // (404). Devuelve cuántos se desactivaron.
  //
  // Salvaguardas:
  //  - Solo corre tras un scan COMPLETO (fullScanCompleted) — un import parcial
  //    no debe purgar.
  //  - Doble confirmación por findBySku: si el driver todavía lo encuentra, NO
  //    se toca (el listado paginado puede tener falsos negativos; by-sku es la
  //    fuente de verdad).
  //  - Circuit breaker: si los "no vistos" superan el 30% de los publicados,
  //    abortamos y solo logueamos. Eso indica un origen caído / scan corrupto,
  //    no una baja real de productos.
  private async deactivateRemovedProducts(
    tenantId: string,
    connectionId: string,
    driver: any,
    credentials: Record<string, string>,
    config: Record<string, unknown> | undefined,
    seenSkus: Set<string>,
  ): Promise<number> {
    // findBySku es opcional en la interfaz del driver. Sin él no podemos
    // confirmar ausencia de forma segura → no purgamos.
    if (typeof driver.findBySku !== 'function') return 0

    // Productos activos publicados en ESTE catalog source (tienen mapping con
    // marketplaceProductId). Solo consideramos los que NO se vieron en el scan.
    const published = await this.prisma.product.findMany({
      where: {
        tenantId,
        status: 'active',
        marketplaceMappings: {
          some: { connectionId, marketplaceProductId: { not: null } },
        },
      },
      select: {
        id: true,
        sku: true,
        inventory: {
          where: { variantId: null, warehouse: { warehouseType: { in: ['online', 'store'] } } },
          select: { id: true, quantity: true },
        },
      },
    })

    const candidates = published.filter((p) => p.sku && !seenSkus.has(String(p.sku)))
    if (candidates.length === 0) return 0

    // Circuit breaker: una baja masiva casi siempre significa que el origen
    // respondió mal, no que el operador sacó medio catálogo.
    const ratio = candidates.length / Math.max(1, published.length)
    if (ratio > 0.3) {
      this.logger.warn(
        `deactivateRemovedProducts: ${candidates.length}/${published.length} (${Math.round(
          ratio * 100,
        )}%) no aparecieron en el scan — supera el 30%, ABORTANDO purga por seguridad (posible origen caído).`,
      )
      return 0
    }

    let deactivated = 0
    for (const p of candidates) {
      // Confirmación dura: ¿el origen realmente ya no lo tiene?
      let stillExists = true
      try {
        const found = await driver.findBySku(credentials, String(p.sku), config)
        stillExists = Array.isArray(found) ? found.length > 0 : !!found
      } catch {
        // Error de red consultando by-sku → NO arriesgamos, lo dejamos como está.
        stillExists = true
      }
      if (stillExists) continue

      // Confirmado ausente → stock 0 en SC + fan-out a marketplaces.
      const hadStock = p.inventory.some((i) => i.quantity !== 0)
      for (const inv of p.inventory) {
        if (inv.quantity !== 0) {
          await this.prisma.inventory.update({ where: { id: inv.id }, data: { quantity: 0 } })
        }
      }
      if (hadStock || p.inventory.length > 0) {
        // pushStockToMarketplaces excluye la propia conexión del catalog source.
        await this.inventoryService.pushStockToMarketplaces(tenantId, p.id, 0, connectionId)
        deactivated++
        this.logger.log(`Producto SKU ${p.sku} eliminado del origen → stock 0 + pausado en marketplaces`)
      }
    }
    return deactivated
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
      let stockChanged = false
      if (existing) {
        if (existing.quantity !== qty) {
          await this.prisma.inventory.update({
            where: { id: existing.id },
            data: { quantity: qty },
          })
          stockChanged = true
        }
      } else {
        await this.prisma.inventory.create({
          data: { tenantId, productId: product.id, warehouseId, quantity: qty },
        })
        stockChanged = true
      }

      // Si el stock cambió, fan-out inmediato a todos los marketplaces vinculados
      // (excluye la propia connection del catalog source — no se publica a sí mismo).
      // El check de stockChanged evita spamear cuando el cron corre cada 5 min sobre
      // un catálogo que no se movió.
      if (stockChanged) {
        const newTotal = await this.inventoryService.totalStockForProduct(tenantId, product.id)
        await this.inventoryService.pushStockToMarketplaces(tenantId, product.id, newTotal, connectionId)
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

  // ── Cron: stock + product sync for tenants that opted in ─────────────────

  // Cada 15 min: los catálogos grandes tardan ~15 min en importar, así que
  // un intervalo más corto solo generaba solapamientos. El guard `importing`
  // saltea cualquier source que todavía tenga un run en vuelo.
  @Cron('0 */15 * * * *')
  async scheduledStockSync() {
    const sources = await this.prisma.connection.findMany({
      where: { isCatalogSource: true, syncEnabled: true, status: 'connected' },
      select: { id: true, tenantId: true, catalogConfig: true, provider: true },
    })

    for (const src of sources) {
      const cfg = (src.catalogConfig as Record<string, unknown> | undefined) ?? {}
      const syncStock = cfg.autoSyncStock !== false
      const syncProducts = cfg.autoSyncProducts === true
      // Si ambos están false (raro), no hay nada que hacer.
      if (!syncStock && !syncProducts) continue
      // Skip si ya hay un import en vuelo para esta conexión.
      if (this.importing.has(src.id)) {
        this.logger.warn(`scheduledStockSync: ${src.provider} todavía corriendo, salteando este tick`)
        continue
      }
      this.importing.add(src.id)
      try {
        // Una sola pasada respeta los dos flags. Antes el cron solo
        // sincronizaba stock y los cambios de name/desc/images del
        // catalog source jamás llegaban al maestro hasta que alguien
        // disparara manualmente runImport con syncProducts:true.
        // Wrap con CronMonitor para historial visible en /sync Monitor.
        await this.cronMonitor.wrap(
          'catalog_source_sync',
          { tenantId: src.tenantId, connectionId: src.id, provider: src.provider },
          async () => {
            const stats = await this.runImport(src.tenantId, { syncProducts, syncStock })
            return { stats }
          },
        )
      } catch (err: any) {
        this.logger.error(`scheduledStockSync failed for ${src.provider}: ${err.message}`)
      } finally {
        this.importing.delete(src.id)
      }
    }
  }
}
