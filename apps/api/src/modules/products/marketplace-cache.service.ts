import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../../prisma/prisma.service'
import { getDriver } from '@stockcentral/integrations'

// MarketplaceCacheService: gestiona el espejo local del catálogo del
// marketplace (tabla MarketplaceProductSnapshot).
//
// Por qué existe: la vista /products/<provider> antes pegaba al
// marketplace en cada request (+ enrich de stock por SKU) → ~15 seg de
// carga por página. Ahora la vista lee solo de la tabla local; el cron
// llena/refresca el espejo cada 30 min en background.
//
// Métodos:
//   - refreshConnection(connectionId): trae TODOS los productos del
//     marketplace usando driver.getProducts(limit=9999) y los upsertea
//     en la tabla. Una sola corrida por connection.
//   - getLastFetchedAt(connectionId): para indicar en UI cuán fresco es
//     el cache.
//
// NO hace cleanup automático de productos viejos. Si el seller borra un
// producto en el market, queda en el cache hasta el siguiente fullSync
// con flag de "se eliminó". Por ahora preferimos ver stock cero a borrar
// la fila — el operador decide manualmente.
@Injectable()
export class MarketplaceCacheService {
  private readonly logger = new Logger(MarketplaceCacheService.name)

  constructor(private readonly prisma: PrismaService) {}

  // Refresca el cache de una conexión específica. Llama al driver con
  // limit=9999 para que itere todas las páginas internamente.
  async refreshConnection(connectionId: string): Promise<{
    fetched: number
    upserted: number
    errors: number
    durationMs: number
  }> {
    const startTime = Date.now()
    const connection = await this.prisma.connection.findUnique({
      where: { id: connectionId },
    })
    if (!connection) throw new Error(`Connection ${connectionId} no existe`)
    if (connection.isCatalogSource) {
      // Catalog sources tienen su propio flujo (CatalogSourceService);
      // no las cacheamos como marketplace productos.
      return { fetched: 0, upserted: 0, errors: 0, durationMs: 0 }
    }

    const driver = getDriver(connection.provider)
    if (driver.supportsWriteSync === false) {
      // Read-only drivers (ej. EYLSTORE) tampoco son markets en sentido
      // estricto — sus productos viven en Product, no necesitan cache.
      return { fetched: 0, upserted: 0, errors: 0, durationMs: 0 }
    }

    const credentials = connection.credentials as Record<string, string>
    const config = connection.config as Record<string, unknown> | undefined

    let fetched = 0
    let upserted = 0
    let errors = 0
    try {
      // limit=9999 hace que el driver itere todas las páginas internas
      // (ver implementación de cada driver). Para Lider eso son ~50
      // productos × 600ms throttle = ~30 seg típico.
      const result = await driver.getProducts(credentials, config, 0, 9999)
      fetched = result.items.length
      this.logger.log(
        `[cache:${connection.provider}] fetched ${fetched} items, upserting...`,
      )

      // Upsert en serie para no abrir demasiadas conexiones a Postgres
      // (cada upsert = 1 round-trip). Con 700+ items en paralelo se
      // saturaba el pool. La serialización agrega ~2-5 seg pero no es
      // crítico — esto corre en background.
      for (const item of result.items) {
        if (!item.externalId) continue
        try {
          await this.prisma.marketplaceProductSnapshot.upsert({
            where: {
              connectionId_externalId: {
                connectionId,
                externalId: item.externalId,
              },
            },
            create: {
              connectionId,
              externalId: item.externalId,
              externalSku: item.externalSku || null,
              title: item.title || null,
              price: item.price ?? null,
              stock: item.stock ?? null,
              status: item.status || null,
              images: (item.images || []) as any,
              url: item.url || null,
              categoryId: item.categoryId || null,
              rawData: (item.rawData ?? null) as any,
              lastFetchedAt: new Date(),
            },
            update: {
              externalSku: item.externalSku || null,
              title: item.title || null,
              price: item.price ?? null,
              stock: item.stock ?? null,
              status: item.status || null,
              images: (item.images || []) as any,
              url: item.url || null,
              categoryId: item.categoryId || null,
              rawData: (item.rawData ?? null) as any,
              lastFetchedAt: new Date(),
            },
          })
          upserted++
        } catch (err: any) {
          this.logger.warn(
            `[cache:${connection.provider}] error upserting ${item.externalId}: ${err.message}`,
          )
          errors++
        }
      }
    } catch (err: any) {
      this.logger.error(
        `[cache:${connection.provider}] fetch failed: ${err.message}`,
      )
      throw err
    }

    const durationMs = Date.now() - startTime
    this.logger.log(
      `[cache:${connection.provider}] done in ${durationMs}ms — fetched=${fetched} upserted=${upserted} errors=${errors}`,
    )
    return { fetched, upserted, errors, durationMs }
  }

  // Devuelve el timestamp del item más recientemente actualizado en cache
  // para una conexión. Sirve para mostrar "actualizado hace 5 min" en UI.
  async getLastFetchedAt(connectionId: string): Promise<Date | null> {
    const row = await this.prisma.marketplaceProductSnapshot.findFirst({
      where: { connectionId },
      orderBy: { lastFetchedAt: 'desc' },
      select: { lastFetchedAt: true },
    })
    return row?.lastFetchedAt ?? null
  }

  // ¿La conexión tiene al menos 1 producto en cache? Si NO, la primera
  // request a la vista debe caer al fetch sincrónico (degradado) para
  // que el operador no vea una lista vacía.
  async hasCache(connectionId: string): Promise<boolean> {
    const c = await this.prisma.marketplaceProductSnapshot.count({
      where: { connectionId },
    })
    return c > 0
  }

  // Cron: cada 30 min refresca el cache de TODAS las conexiones activas.
  // Procesa en serie para no saturar marketplaces ni el pool de Postgres
  // — con ~4 marketplaces × ~30 seg c/u = ~2 min totales por tick.
  // Tira y olvida: si una falla, loggea y sigue con la siguiente.
  @Cron(CronExpression.EVERY_30_MINUTES)
  async scheduledMarketplaceCacheRefresh() {
    const connections = await this.prisma.connection.findMany({
      where: { syncEnabled: true, status: 'connected', isCatalogSource: false },
      select: { id: true, provider: true, name: true },
    })
    this.logger.log(
      `[cache cron] iniciando refresh de ${connections.length} conexiones`,
    )
    for (const conn of connections) {
      try {
        const driver = getDriver(conn.provider)
        if (driver.supportsWriteSync === false) continue
        await this.refreshConnection(conn.id)
      } catch (err: any) {
        this.logger.error(
          `[cache cron] fallo en ${conn.provider}: ${err.message}`,
        )
      }
    }
    this.logger.log(`[cache cron] tick completo`)
  }
}
