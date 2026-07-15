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

      // Barrido de items HUÉRFANOS/DUPLICADOS en los marketplaces target.
      // deactivateRemovedProducts solo ve items con mapping en SC. Pero en ML
      // puede haber publicaciones del mismo SKU que SC NO tiene mapeadas (un
      // SKU con 2 items: uno mapeado, otro no). El no-mapeado se sigue vendiendo
      // aunque el producto ya no exista en el origen. Este barrido consulta el
      // catálogo REAL del marketplace por seller_custom_field y pausa los
      // activos cuyo SKU no esté vivo en el origen.
      try {
        const orphaned = await this.pauseOrphanedMarketplaceItems(tenantId, conn.id, seenSkus)
        ;(stats as any).orphansPaused = orphaned
      } catch (err: any) {
        this.logger.error(`pauseOrphanedMarketplaceItems failed: ${err?.message}`)
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
      `Catalog import [${conn.provider}] tenant=${tenantId} scanned=${stats.scanned} created=${stats.created} updated=${stats.updated} unchanged=${stats.unchanged} errors=${stats.errors} removed=${(stats as any).removedFromSource ?? 0} orphansPaused=${(stats as any).orphansPaused ?? 0}`,
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

  // Pausa las publicaciones ACTIVAS en los marketplaces target cuyo SKU
  // (seller_custom_field) YA NO esté vivo en el origen (no está en seenSkus).
  // Cubre el gap de deactivateRemovedProducts: items huérfanos/duplicados que
  // SC no tiene mapeados y que por eso nunca se pausaban (se seguían vendiendo
  // aunque el producto estuviera archivado en el origen).
  //
  // Salvaguardas (idénticas a deactivateRemovedProducts):
  //  - Solo corre tras un scan COMPLETO del origen (garantizado por el caller).
  //  - Confirmación por findBySku: el SKU debe estar realmente ausente (404).
  //  - Circuit breaker: si los "a pausar" superan el 30% de los activos del
  //    marketplace, aborta (indica origen caído / scan incompleto).
  private async pauseOrphanedMarketplaceItems(
    tenantId: string,
    catalogConnectionId: string,
    seenSkus: Set<string>,
  ): Promise<number> {
    // Marketplaces target del tenant: conexiones distintas del catalog source,
    // conectadas, con syncEnabled, cuyo driver soporte listActiveItems + updateStock.
    const targets = await this.prisma.connection.findMany({
      where: {
        tenantId,
        status: 'connected',
        syncEnabled: true,
        id: { not: catalogConnectionId },
      },
      select: { id: true, provider: true, credentials: true, config: true },
    })

    let totalPaused = 0
    for (const target of targets) {
      let driver: any
      try {
        driver = getDriver(target.provider)
      } catch {
        continue
      }
      if (typeof driver.listActiveItems !== 'function' || typeof driver.updateStock !== 'function') continue

      const credentials = target.credentials as Record<string, string>
      const config = target.config as Record<string, unknown> | undefined

      let active: Array<{ externalId: string; externalSku: string; userProductId?: string }>
      try {
        active = await driver.listActiveItems(credentials, config)
      } catch (err: any) {
        this.logger.error(`listActiveItems [${target.provider}] failed: ${err?.message}`)
        continue
      }

      // Candidatos: activos con SKU conocido que NO está vivo en el origen.
      const candidates = active.filter((it) => it.externalSku && !seenSkus.has(String(it.externalSku)))
      if (candidates.length === 0) continue

      // Circuit breaker.
      const ratio = candidates.length / Math.max(1, active.length)
      if (ratio > 0.3) {
        this.logger.warn(
          `pauseOrphaned [${target.provider}]: ${candidates.length}/${active.length} (${Math.round(
            ratio * 100,
          )}%) activos con SKU no-vivo — supera 30%, ABORTANDO por seguridad.`,
        )
        continue
      }

      // Confirmación por findBySku: el scan completo + circuit breaker ya dan
      // confianza, pero el listado paginado del origen puede tener falsos
      // negativos (un SKU vivo que no salió en el scan). Confirmamos cada
      // candidato contra el origen (findBySku → 404 = realmente muerto) para NO
      // pausar productos buenos. Es el mismo criterio que deactivateRemovedProducts.
      let paused = 0
      for (const it of candidates) {
        const stillAlive = await this.isSkuAliveInSource(tenantId, it.externalSku)
        if (stillAlive) continue

        try {
          // updateStock a 0 → el driver pausa el item (out_of_stock).
          await driver.updateStock(credentials, it.externalId, 0, config)
          paused++
          this.logger.log(
            `pauseOrphaned [${target.provider}]: item ${it.externalId} SKU ${it.externalSku} pausado (huérfano/duplicado, SKU no vive en origen)`,
          )
        } catch (err: any) {
          this.logger.error(`pauseOrphaned: fallo pausando ${it.externalId}: ${err?.message}`)
        }
      }
      totalPaused += paused
    }
    return totalPaused
  }

  // Confirma si un SKU sigue vivo en el catalog source activo (via findBySku).
  // true si existe / si no podemos confirmar (error de red → no arriesgamos).
  private async isSkuAliveInSource(tenantId: string, sku: string): Promise<boolean> {
    const source = await this.getActive(tenantId)
    if (!source) return true
    let driver: any
    try {
      driver = getDriver(source.provider)
    } catch {
      return true
    }
    if (typeof driver.findBySku !== 'function') return true
    try {
      const found = await driver.findBySku(
        source.credentials as Record<string, string>,
        String(sku),
        source.config as Record<string, unknown> | undefined,
      )
      return Array.isArray(found) ? found.length > 0 : !!found
    } catch {
      return true
    }
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
