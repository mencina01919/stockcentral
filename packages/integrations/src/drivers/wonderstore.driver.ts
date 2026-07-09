import axios, { AxiosInstance } from 'axios'
import { createHash } from 'crypto'
import {
  IMarketplaceDriver,
  DriverCredentials,
  DriverConfig,
  ConnectionTestResult,
  MarketplaceProduct,
  MarketplaceOrder,
  SyncResult,
  PaginatedResult,
  CatalogCapabilities,
} from '../types'

// WonderStore — ecommerce con lectura de catálogo + descuento atómico de stock.
// API: https://wonderstore.cl/api/v1
// Auth: Bearer token (Authorization: Bearer ws_...).
// Endpoints:
//   GET  /products?page=N&perPage=50         catálogo paginado
//   GET  /products/{slug}                    detalle
//   GET  /stock/by-sku/{sku}                 stockTiendas + stockOnline + stockTotal
//   POST /stock/reduce                       descuento idempotente por clientOrderId
// STOCK VENDIBLE: `stockTiendas` + `stockPropio`. `stockOnline` NO se
// comercializa por este canal y NO se cuenta. NO usar stockTotal (= tiendas +
// online + propio) porque incluye el online → sobreventa. La API agregó
// stockPropio en jul-2026; antes solo se usaba stockTiendas.
// Rate limits: 60/min get products · 120/min stock · 120/min reduce.
// Errores: 401/403 auth · 404 SKU_NOT_FOUND/SLUG_NOT_FOUND · 409 INSUFFICIENT_STOCK · 429 con Retry-After.

const DEFAULT_BASE_URL = 'https://wonderstore.cl/api/v1'
// perPage=100: la API de WonderStore es consistente con este tamaño (total ==
// suma de items en las 50 páginas). Con 50 hacía el doble de requests, más
// frágil ante rate-limit y pérdida de páginas.
const PAGE_SIZE = 100
const SLUG_CACHE_TTL_MS = 10 * 60 * 1000

// Stock vendible para marketplaces desde WonderStore.
//
// FUENTES: `stockTiendas` (tiendas físicas) + `stockPropio` (stock propio de
// WonderStore, ej. productos cargados directo). El `stockOnline` NO se
// comercializa por este canal y NUNCA se cuenta. (La API expone stockTotal =
// tiendas + online + propio, por eso NO se usa stockTotal directamente.)
//
// REGLA última unidad: si el vendible resultante es 1 (o menos), se publica 0
// → ML pausa el item (out_of_stock). Evita vender el único ejemplar (suele ser
// muestra de exhibición / reservado). Con 2+ se vende normal.
//
// Esta es la ÚNICA fuente de la regla: todos los cálculos de stock del driver
// pasan por aquí. `body` es el objeto de /stock/by-sku o del listado.
function rawSellable(body: any): number {
  const tiendas = Number(body?.stockTiendas ?? body?.stock?.tiendas ?? 0) || 0
  const propio = Number(body?.stockPropio ?? body?.stock?.propio ?? 0) || 0
  return tiendas + propio
}

function sellableStock(body: any): number {
  const vendible = rawSellable(body)
  return vendible <= 1 ? 0 : vendible
}

export class WonderStoreDriver implements IMarketplaceDriver {
  readonly provider = 'wonderstore'
  readonly supportsWriteSync = true
  readonly catalogCapabilities: CatalogCapabilities = {
    canBeCatalogSource: true,
    supportsPagination: true,
    providesStock: true,
    providesPrices: true,
    providesImages: true,
    supportsSingleProductFetch: true,
    // WonderStore es catalog source PERO recibe fan-out de stock vía
    // POST /stock/reduce. Distinto de EYLSTORE (puro read-only).
    acceptsStockSync: true,
    // ~300 páginas → wonderstore.cl rate-limitea sin pausa. 250ms entre
    // páginas mantiene el import bajo el límite.
    pageDelayMs: 250,
  }

  // Cache slug→sku para evitar 1 GET extra por cada updateStock.
  // Key: `${apiKey}:${slug}`. Value: { sku, expiresAt }.
  private slugToSku = new Map<string, { sku: string; expiresAt: number }>()

  private buildClient(credentials: DriverCredentials, config?: DriverConfig): AxiosInstance {
    const baseURL = (config?.baseUrl as string) || DEFAULT_BASE_URL
    const client = axios.create({
      baseURL,
      // 45s: bajo carga (import de ~300 páginas) wonderstore.cl a veces tarda
      // >20s en responder una página. El timeout previo cortaba el import.
      timeout: 45000,
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    })
    // Reintento para 429 y timeouts con backoff exponencial. Catálogos
    // grandes (WonderStore ~15k productos = ~300 páginas) rate-limitean fuerte
    // y a veces tardan >20s; 2 reintentos no alcanzaban. 5 con backoff.
    client.interceptors.response.use(undefined, async (error) => {
      const cfg: any = error.config
      const isRateLimit = error.response?.status === 429
      const isTimeout = error.code === 'ECONNABORTED' || /timeout/i.test(error.message || '')
      if (!cfg || (!isRateLimit && !isTimeout)) return Promise.reject(error)
      cfg.__retry = (cfg.__retry || 0) + 1
      if (cfg.__retry > 5) return Promise.reject(error)
      // Retry-After del server si viene; si no, backoff 3s,6s,12s,24s,30s.
      const retryAfter = Number(error.response?.headers?.['retry-after'])
      const backoff = retryAfter || Math.min(3 * 2 ** (cfg.__retry - 1), 30)
      await new Promise((r) => setTimeout(r, Math.min(backoff, 30) * 1000))
      return client.request(cfg)
    })
    return client
  }

  async testConnection(credentials: DriverCredentials, config?: DriverConfig): Promise<ConnectionTestResult> {
    try {
      const client = this.buildClient(credentials, config)
      const res = await client.get('/products', { params: { page: 1, perPage: 1 } })
      const total = res.data?.meta?.total
      return {
        success: true,
        shopName: 'WonderStore',
        shopUrl: 'https://wonderstore.cl',
        sellerId: typeof total === 'number' ? `${total} productos` : undefined,
      }
    } catch (err: any) {
      return {
        success: false,
        error: err?.response?.data?.message || err?.response?.data?.error || err.message,
      }
    }
  }

  async getProducts(
    credentials: DriverCredentials,
    config?: DriverConfig,
    offset = 0,
    limit = PAGE_SIZE,
  ): Promise<PaginatedResult<MarketplaceProduct>> {
    const client = this.buildClient(credentials, config)
    // El catalog sync avanza offset += items.length en cada vuelta. Pedimos la
    // página que contiene ese offset. Para no perder productos, alineamos el
    // offset al múltiplo de PAGE_SIZE (el caller avanza de a PAGE_SIZE, así que
    // siempre cae alineado; si no, tomamos la página completa desde el inicio
    // de ese bloque). Devolvemos la página COMPLETA — nada de slice frágil.
    const page = Math.floor(offset / PAGE_SIZE) + 1

    // Reintento por página: si una página falla (red/rate-limit), reintentamos
    // en vez de devolver vacío (que cortaría el scan y perdería el resto del
    // catálogo).
    let res: any = null
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        res = await client.get('/products', { params: { page, perPage: PAGE_SIZE } })
        break
      } catch (err: any) {
        if (attempt === 3) throw err
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
      }
    }

    // WonderStore devuelve: { items, page, perPage, total, totalPages }.
    // Mantenemos fallbacks por si el shape cambia (data/products/array directo).
    const data: any[] =
      res.data?.items ||
      res.data?.data ||
      res.data?.products ||
      (Array.isArray(res.data) ? res.data : [])
    const total: number =
      Number(res.data?.total) ||
      Number(res.data?.meta?.total) ||
      Number(res.data?.pagination?.total) ||
      data.length
    const totalPages: number = Number(res.data?.totalPages) || Math.ceil(total / PAGE_SIZE)

    const items = data.map((p) => this.mapProduct(p))

    // hasMore por número de página (robusto): hay más mientras no lleguemos a la
    // última página reportada por la API.
    return {
      items,
      total,
      offset,
      limit: PAGE_SIZE,
      hasMore: page < totalPages,
    }
  }

  async getProduct(
    credentials: DriverCredentials,
    externalId: string,
    config?: DriverConfig,
  ): Promise<MarketplaceProduct | null> {
    try {
      const client = this.buildClient(credentials, config)
      const res = await client.get(`/products/${encodeURIComponent(externalId)}`)
      const raw = res.data?.data || res.data
      return raw ? this.mapProduct(raw) : null
    } catch {
      return null
    }
  }

  async findBySku(
    credentials: DriverCredentials,
    sku: string,
    config?: DriverConfig,
  ): Promise<MarketplaceProduct[]> {
    if (!sku) return []
    const client = this.buildClient(credentials, config)
    // 1) Check directo de existencia y stock.
    let stockResp: any = null
    try {
      const r = await client.get(`/stock/by-sku/${encodeURIComponent(sku)}`)
      stockResp = r.data?.data || r.data
    } catch (err: any) {
      // 404 = SKU no existe en WonderStore.
      if (err?.response?.status === 404) return []
      throw err
    }
    if (!stockResp) return []

    // 2) Intentar enriquecer con detalle de producto via búsqueda por SKU.
    try {
      const search = await client.get('/products', { params: { q: sku, perPage: 1 } })
      const data: any[] = search.data?.data || search.data?.products || []
      const match = data.find(
        (p) => String(p?.sku ?? p?.SKU ?? '').toLowerCase() === sku.toLowerCase(),
      ) || data[0]
      if (match) {
        const mapped = this.mapProduct(match)
        // Stock vendible = tiendas + propio (ver sellableStock). Lo tomamos del
        // endpoint stock (es más fresco que el listado).
        const stock = sellableStock(stockResp)
        return [{ ...mapped, stock }]
      }
    } catch {
      // si /products?q= no soporta el filtro o falla, caemos al fallback.
    }

    // 3) Fallback: devolver mínimo con el sku como externalId.
    const stock = sellableStock(stockResp)
    return [
      {
        externalId: String(sku),
        externalSku: String(sku),
        title: '',
        price: 0,
        stock,
        images: [],
        status: stock > 0 ? 'active' : 'paused',
        rawData: stockResp,
      },
    ]
  }

  async createProduct(): Promise<SyncResult> {
    return {
      success: false,
      error: 'WonderStore no expone gestión de catálogo vía API. Crea el producto en su panel.',
    }
  }

  async updateProduct(): Promise<SyncResult> {
    return {
      success: false,
      error: 'WonderStore no expone gestión de catálogo vía API.',
    }
  }

  async updateStock(
    credentials: DriverCredentials,
    externalId: string,
    targetStock: number,
    config?: DriverConfig,
  ): Promise<SyncResult> {
    const client = this.buildClient(credentials, config)
    const target = Math.max(0, Math.floor(Number(targetStock) || 0))

    // 1) Resolver el SKU. externalId puede ser slug o sku.
    //    Estrategia: probamos primero /stock/by-sku/{externalId}; si 404,
    //    asumimos que es slug y hacemos /products/{slug} para sacar el sku.
    let sku: string | null = null
    let currentStock = 0

    try {
      const r = await client.get(`/stock/by-sku/${encodeURIComponent(externalId)}`)
      const body = r.data?.data || r.data
      sku = String(body.sku ?? externalId)
      // Stock vendible = tiendas + propio (sin la regla de última unidad: aquí
      // es el stock físico real para calcular el delta del /stock/reduce).
      currentStock = rawSellable(body)
    } catch (err: any) {
      if (err?.response?.status !== 404) {
        return {
          success: false,
          error: `WonderStore: error consultando stock — ${this.errMsg(err)}`,
        }
      }
      // No es SKU. Intentamos como slug.
      sku = await this.resolveSluToSku(client, credentials.apiKey, externalId)
      if (!sku) {
        return { success: false, error: `WonderStore: no se pudo resolver SKU para ${externalId}` }
      }
      try {
        const r2 = await client.get(`/stock/by-sku/${encodeURIComponent(sku)}`)
        const body = r2.data?.data || r2.data
        // Stock vendible = tiendas + propio (stock físico real para el delta).
        currentStock = rawSellable(body)
      } catch (err2: any) {
        return {
          success: false,
          error: `WonderStore: SKU ${sku} no encontrado tras resolver slug`,
        }
      }
    }

    const delta = currentStock - target

    if (delta === 0) {
      return {
        success: true,
        externalId,
        rawResponse: { noop: true, current: currentStock, target },
      }
    }

    if (delta < 0) {
      // No tenemos endpoint de incremento. Marcamos success para no romper
      // el fan-out — el operador verá el desfase en logs.
      // eslint-disable-next-line no-console
      console.warn(
        `[wonderstore] No se puede incrementar stock vía API. SKU=${sku} current=${currentStock} target=${target} (diff +${-delta})`,
      )
      return {
        success: true,
        externalId,
        rawResponse: {
          skipped: 'increase_not_supported',
          current: currentStock,
          target,
        },
      }
    }

    // delta > 0 → descontamos.
    // clientOrderId determinístico: mismo (sku,target,current) → mismo id →
    // reintentos del job Bull no descuentan doble (la API responde duplicado).
    const clientOrderId =
      'sc-' +
      createHash('sha256')
        .update(`${sku}|${target}|${currentStock}`)
        .digest('hex')
        .slice(0, 32)

    try {
      const res = await client.post('/stock/reduce', {
        clientOrderId,
        items: [{ sku, quantity: delta, branch: 'auto' }],
      })
      return {
        success: true,
        externalId,
        rawResponse: res.data,
      }
    } catch (err: any) {
      const status = err?.response?.status
      const code = err?.response?.data?.code
      if (status === 409 || code === 'INSUFFICIENT_STOCK') {
        return {
          success: false,
          error: `WonderStore: stock insuficiente para descontar ${delta} unidades del SKU ${sku}`,
        }
      }
      if (status === 404 || code === 'SKU_NOT_FOUND') {
        return { success: false, error: `WonderStore: SKU ${sku} no encontrado` }
      }
      return { success: false, error: `WonderStore: ${this.errMsg(err)}` }
    }
  }

  async getOrders(
    _credentials: DriverCredentials,
    _config?: DriverConfig,
    _since?: Date,
    offset = 0,
    limit = 50,
  ): Promise<PaginatedResult<MarketplaceOrder>> {
    return { items: [], total: 0, offset, limit, hasMore: false }
  }

  async getOrder(): Promise<MarketplaceOrder | null> {
    return null
  }

  // ─── helpers ───────────────────────────────────────────────────────────────

  private async resolveSluToSku(
    client: AxiosInstance,
    apiKey: string,
    slug: string,
  ): Promise<string | null> {
    const cacheKey = `${apiKey}:${slug}`
    const cached = this.slugToSku.get(cacheKey)
    const now = Number(new Date())
    if (cached && cached.expiresAt > now) return cached.sku

    try {
      const r = await client.get(`/products/${encodeURIComponent(slug)}`)
      const body = r.data?.data || r.data
      const sku = body?.sku ? String(body.sku) : null
      if (sku) {
        this.slugToSku.set(cacheKey, { sku, expiresAt: now + SLUG_CACHE_TTL_MS })
      }
      return sku
    } catch {
      return null
    }
  }

  private errMsg(err: any): string {
    return (
      err?.response?.data?.message ||
      err?.response?.data?.error ||
      err?.message ||
      'error desconocido'
    )
  }

  private mapProduct(data: any): MarketplaceProduct {
    // Stock vendible = tiendas + propio (el online NO se comercializa). La
    // última unidad tampoco se vende. Todo centralizado en sellableStock.
    const stock = sellableStock(data)

    // Precio: WonderStore puede exponer prices.normal / price / sale_price.
    // Tomamos el primero válido > 0.
    const prices = data.prices || {}
    const price =
      Number(prices.normal) ||
      Number(prices.sale) ||
      Number(data.price) ||
      Number(data.salePrice) ||
      Number(data.priceFinal) ||
      0

    const images: string[] = []
    if (data.images?.main) images.push(data.images.main)
    if (Array.isArray(data.images?.gallery)) {
      for (const url of data.images.gallery) {
        if (typeof url === 'string' && !images.includes(url)) images.push(url)
      }
    }
    if (Array.isArray(data.images) && !images.length) {
      for (const url of data.images) {
        if (typeof url === 'string') images.push(url)
      }
    }
    if (data.image && !images.length) images.push(data.image)

    const slug = data.slug || String(data.id || data.sku || '')

    return {
      externalId: slug,
      externalSku: data.sku != null ? String(data.sku) : undefined,
      title: data.name || data.title || '',
      description: typeof data.description === 'string' ? data.description : undefined,
      price,
      stock,
      images,
      categoryId:
        data.category?.slug ||
        (data.category?.id != null ? String(data.category.id) : undefined),
      status: stock > 0 ? 'active' : 'paused',
      url: slug ? `https://wonderstore.cl/producto/${slug}` : undefined,
      rawData: data,
    }
  }
}
