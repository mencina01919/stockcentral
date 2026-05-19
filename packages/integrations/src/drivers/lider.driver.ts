import axios, { AxiosInstance } from 'axios'
import { randomUUID } from 'crypto'
import { XMLParser } from 'fast-xml-parser'
import {
  IMarketplaceDriver,
  DriverCredentials,
  DriverConfig,
  ConnectionTestResult,
  MarketplaceProduct,
  MarketplaceOrder,
  SyncProductInput,
  SyncResult,
  PaginatedResult,
} from '../types'

// Lider Marketplace = Walmart Chile
// Docs: https://developer.walmart.com/doc/cl/
// Prod requests: https://marketplace.walmartapis.com
// Sandbox requests: https://sandbox.walmartapis.com  (token endpoint stays on marketplace)
// Market header WM_MARKET must always be "cl"
// All API calls require BOTH Authorization: Basic AND WM_SEC.ACCESS_TOKEN headers.

const PROD_BASE_URL = 'https://marketplace.walmartapis.com'
const SANDBOX_BASE_URL = 'https://sandbox.walmartapis.com'
// Token endpoint is always on marketplace.walmartapis.com regardless of sandbox/prod
const TOKEN_URL = `${PROD_BASE_URL}/v3/token`
const SANDBOX_CLIENT_ID = 'a8097210-620a-40b3-ba1b-58e8ae9955e2'
const SANDBOX_CLIENT_SECRET = 'P1izCpF1aCanYQPYzfbAmHZRI8s2hTf8oVVUGOaFewLzknSsI7PbV7Q4gh33_MI1nAu_7g3OMCO5N8gC1WNk6Q'

/**
 * Lider (Walmart Chile) Marketplace driver.
 *
 * Auth: OAuth 2.0 client_credentials.
 *   1. Base64-encode "clientId:clientSecret"
 *   2. POST /v3/token with Authorization: Basic <encoded> and grant_type=client_credentials
 *   3. Use the returned access_token in header WM_SEC.ACCESS_TOKEN (expires in 15 min)
 *   4. Token is cached and auto-refreshed when <2 min remain.
 *
 * Credentials (stored in Connection.credentials):
 *   - clientId:     Walmart seller client ID
 *   - clientSecret: Walmart seller client secret
 *
 * Config (stored in Connection.config):
 *   - sandbox?: true to use sandbox credentials (overrides clientId/clientSecret)
 */
// Walmart Chile aplica rate limit por seller. Sin throttle el cron sincroniza
// docenas de productos a 102 req/min (51 productos × updateProduct+updateStock)
// y gatilla 429 → circuit breaker → connection auto-disabled. Mantenemos un
// gap mínimo entre requests y un retry exponencial sobre 429.
const MIN_REQUEST_GAP_MS = 500

export class LiderDriver implements IMarketplaceDriver {
  readonly provider = 'lider'

  // Token cache keyed by clientId. Token expires in 15 min; we refresh at <2 min.
  private tokenCache = new Map<string, { token: string; expiresAt: number }>()

  // Mutex chain por clientId: cada request awaitea la cola previa antes de
  // disparar. Esto garantiza serialización real aunque N jobs en paralelo
  // construyan N axios instances — el "lock" es a nivel driver, no cliente.
  // Sin esto, el interceptor leía/escribía `lastRequestAt` con races y dos
  // requests salían a la vez, gatillando 429 de Walmart.
  private requestChain = new Map<string, Promise<void>>()

  private getClientCredentials(credentials: DriverCredentials, config?: DriverConfig): { clientId: string; clientSecret: string } {
    if (config?.sandbox === true) {
      return { clientId: SANDBOX_CLIENT_ID, clientSecret: SANDBOX_CLIENT_SECRET }
    }
    const clientId = credentials.clientId
    const clientSecret = credentials.clientSecret
    if (!clientId || !clientSecret) {
      throw new Error('Lider driver: missing clientId or clientSecret in credentials')
    }
    return { clientId, clientSecret }
  }

  private async getAccessToken(credentials: DriverCredentials, config?: DriverConfig): Promise<string> {
    const { clientId, clientSecret } = this.getClientCredentials(credentials, config)
    const cacheKey = clientId

    const cached = this.tokenCache.get(cacheKey)
    if (cached && cached.expiresAt - Date.now() > 2 * 60 * 1000) {
      return cached.token
    }

    const encoded = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

    const res = await axios.post(
      TOKEN_URL,
      'grant_type=client_credentials',
      {
        headers: {
          Authorization: `Basic ${encoded}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'WM_MARKET': 'cl',
          'WM_SVC.NAME': 'Walmart Marketplace',
          'WM_QOS.CORRELATION_ID': randomUUID(),
          Accept: 'application/json',
        },
      },
    )

    // Response can be XML (<OAuthTokenDTO>) or JSON depending on Accept header
    let parsed: any = res.data
    if (typeof parsed === 'string' && parsed.trim().startsWith('<')) {
      const parser = new XMLParser()
      parsed = parser.parse(parsed)?.OAuthTokenDTO || {}
    }

    const token = parsed?.access_token || parsed?.accessToken
    const expiresIn = parseInt(parsed?.expires_in || parsed?.expiresIn || '900', 10)

    if (!token) throw new Error('Lider driver: no access_token in auth response')

    this.tokenCache.set(cacheKey, {
      token,
      expiresAt: Date.now() + expiresIn * 1000,
    })
    return token
  }

  private getBaseUrl(config?: DriverConfig): string {
    return config?.sandbox === true ? SANDBOX_BASE_URL : PROD_BASE_URL
  }

  private async buildClient(credentials: DriverCredentials, config?: DriverConfig): Promise<AxiosInstance> {
    const { clientId, clientSecret } = this.getClientCredentials(credentials, config)
    const token = await this.getAccessToken(credentials, config)
    const encoded = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    const client = axios.create({
      baseURL: this.getBaseUrl(config),
      timeout: 30000,
      headers: {
        // Walmart CL requires both Basic auth AND the bearer token on every request
        Authorization: `Basic ${encoded}`,
        'WM_SEC.ACCESS_TOKEN': token,
        'WM_MARKET': 'cl',
        'WM_SVC.NAME': 'Walmart Marketplace',
        'WM_QOS.CORRELATION_ID': randomUUID(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    })

    // Throttle serializado por seller con mutex chain. Cada request engancha
    // su espera al final de la cadena previa, garantizando que dos jobs en
    // paralelo no salgan al mismo tiempo. Sin esto el cron en paralelo
    // dispara 429 de Walmart aunque cada instancia individual respete su
    // propio gap.
    client.interceptors.request.use(async (cfg) => {
      const prev = this.requestChain.get(clientId) ?? Promise.resolve()
      let release!: () => void
      const next = new Promise<void>((r) => { release = r })
      // Sumamos nuestro lock al final de la cadena ANTES de awaitear
      this.requestChain.set(clientId, prev.then(() => next))
      await prev
      // Solo después de adquirir el lock dormimos el gap mínimo
      await new Promise((r) => setTimeout(r, MIN_REQUEST_GAP_MS))
      // Liberar el lock al final del request (response interceptor) — pero
      // como axios no expone hook directo post-response sincrónico, lo
      // soltamos en el response success/error abajo y guardamos `release`
      // en cfg para acceso desde el interceptor de respuesta.
      ;(cfg as any).__release = release
      return cfg
    })

    const releaseLock = (cfg: any) => {
      const r = cfg?.__release
      if (typeof r === 'function') {
        cfg.__release = null
        r()
      }
    }

    // Response interceptor: libera el mutex y reintenta sobre 429.
    client.interceptors.response.use(
      (res) => {
        releaseLock(res.config)
        return res
      },
      async (err) => {
        const status = err?.response?.status
        const cfg: any = err?.config
        if (status !== 429 || !cfg) {
          releaseLock(cfg)
          throw err
        }
        cfg.__retryCount = (cfg.__retryCount ?? 0) + 1
        // 2 reintentos rápidos (1s, 3s = total ~5s incluyendo HTTP). Si
        // Walmart sigue 429 después, fallamos rápido para no colgar la
        // UI. El operador puede reintentar manualmente cuando quiera.
        // Para sincros masivas el bulk-sync tiene su propio retry y
        // background processing.
        if (cfg.__retryCount > 2) {
          releaseLock(cfg)
          throw err
        }
        releaseLock(cfg)
        const retryAfter = parseFloat(err.response.headers?.['retry-after'] ?? '')
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(5000, retryAfter * 1000)
          : 1000 * cfg.__retryCount  // 1s, 2s
        await new Promise((r) => setTimeout(r, waitMs))
        return client.request(cfg)
      },
    )

    return client
  }

  // ─── testConnection ──────────────────────────────────────────────────────────

  async testConnection(credentials: DriverCredentials, config?: DriverConfig): Promise<ConnectionTestResult> {
    try {
      await this.getAccessToken(credentials, config)
      const { clientId } = this.getClientCredentials(credentials, config)
      return {
        success: true,
        sellerId: clientId,
        shopName: 'Lider (Walmart Chile)',
      }
    } catch (err: any) {
      return {
        success: false,
        error: err?.response?.data?.errors?.[0]?.description || err?.response?.data?.message || err.message,
      }
    }
  }

  // ─── Products ────────────────────────────────────────────────────────────────

  async getProducts(
    credentials: DriverCredentials,
    config?: DriverConfig,
    offset = 0,
    limit = 50,
  ): Promise<PaginatedResult<MarketplaceProduct>> {
    const client = await this.buildClient(credentials, config)

    // Walmart Chile GMP_ITEM_QUERY_API: limit máximo permitido = 50.
    // Paginación por offset/limit (no devuelve nextCursor).
    const PAGE_SIZE = 50

    // Walmart /v3/items no acepta búsqueda nativa. Manejamos `searchQuery`
    // del caller con dos heurísticas:
    //  1. Si parece un SKU exacto (alfanumérico corto sin espacios) →
    //     /v3/items/{sku} directo. Una sola call, instantáneo.
    //  2. Si es un texto libre → traer TODAS las páginas y filtrar por
    //     SKU/título client-side. Lider típicamente <500 items por seller,
    //     manejable.
    const cfg = (config || {}) as Record<string, any>
    const searchQuery: string | undefined = cfg.searchQuery?.trim()

    // Enrichment helper: /v3/items no devuelve inventory; lo traemos del
    // endpoint dedicado. Encolado por el mutex del driver, así una página
    // de 25 productos tarda ~25×500ms = 12s pero sin gatillar rate limits.
    const enrichWithStock = async (mp: MarketplaceProduct): Promise<MarketplaceProduct> => {
      if (!mp.externalSku) return mp
      try {
        const r = await client.get(`/v3/inventory`, { params: { sku: mp.externalSku } })
        const amount = parseInt(r.data?.quantity?.amount ?? '0', 10)
        return { ...mp, stock: Number.isFinite(amount) ? amount : mp.stock }
      } catch {
        // Walmart devuelve 404 cuando el item aún no terminó setup interno
        // (típico de items recién cargados). Mantenemos el stock=0 inicial.
        return mp
      }
    }

    // Search exacto por SKU (atajo rápido)
    if (searchQuery && /^[A-Za-z0-9_\-]{1,40}$/.test(searchQuery) && !/\s/.test(searchQuery)) {
      try {
        const r = await client.get(`/v3/items/${encodeURIComponent(searchQuery)}`)
        const data = r.data?.ItemResponse?.[0] ?? r.data
        if (data) {
          const mp = this.mapProduct(data)
          const enriched = await enrichWithStock(mp)
          return {
            items: [enriched],
            total: 1,
            offset: 0,
            limit: 1,
            hasMore: false,
          }
        }
      } catch {
        // No es un SKU exacto — caemos al modo "traer todos y filtrar"
      }
    }

    // Search por texto libre: trae todas las páginas y filtra client-side.
    if (searchQuery) {
      const allItems: MarketplaceProduct[] = []
      let pageOffset = 0
      let total = 0
      while (true) {
        const params: Record<string, any> = { limit: PAGE_SIZE }
        if (pageOffset > 0) params.offset = pageOffset
        const res = await client.get('/v3/items', { params })
        const batch = res.data?.ItemResponse || []
        total = res.data?.totalItems ?? (allItems.length + batch.length)
        for (const p of batch) allItems.push(this.mapProduct(p))
        if (batch.length < PAGE_SIZE || allItems.length >= total) break
        pageOffset += PAGE_SIZE
      }
      const q = searchQuery.toLowerCase()
      const filtered = allItems.filter(
        (p) =>
          (p.externalSku || '').toLowerCase().includes(q) ||
          (p.title || '').toLowerCase().includes(q) ||
          (p.externalId || '').toLowerCase().includes(q),
      )
      const page = filtered.slice(offset, offset + Math.min(limit, PAGE_SIZE))
      const enriched = await Promise.all(page.map(enrichWithStock))
      return {
        items: enriched,
        total: filtered.length,
        offset,
        limit: page.length,
        hasMore: offset + page.length < filtered.length,
      }
    }

    // If caller wants all products (limit >= 9999), iterate all pages via offset
    if (limit >= 9999) {
      const allItems: MarketplaceProduct[] = []
      let pageOffset = 0
      let total = 0

      while (true) {
        const params: Record<string, any> = { limit: PAGE_SIZE }
        if (pageOffset > 0) params.offset = pageOffset
        const res = await client.get('/v3/items', { params })
        const batch = res.data?.ItemResponse || []
        total = res.data?.totalItems ?? (allItems.length + batch.length)
        for (const p of batch) allItems.push(this.mapProduct(p))
        if (batch.length < PAGE_SIZE || allItems.length >= total) break
        pageOffset += PAGE_SIZE
      }

      // Enrich con /v3/inventory para CADA producto. Es caro (N calls
      // × 500ms throttle = ~30s para 51 items), pero el cache refresh
      // corre cada 30 min en background — el usuario no espera esto.
      // Sin esto, los productos quedan con stock=0 en el cache aunque
      // Walmart sí los tenga con stock real.
      const enrichedAll = await Promise.all(allItems.map(enrichWithStock))

      const page = enrichedAll.slice(offset, offset + 9999)
      return { items: page, total: enrichedAll.length, offset, limit, hasMore: false }
    }

    // Standard paginated call — cap limit a 50 (máximo de Walmart Chile)
    const effectiveLimit = Math.min(limit, PAGE_SIZE)
    const params: Record<string, any> = { limit: effectiveLimit }
    if (offset > 0) params.offset = offset
    const res = await client.get('/v3/items', { params })
    const items = res.data?.ItemResponse || []
    const total = res.data?.totalItems ?? items.length
    const mapped = items.map((p: any) => this.mapProduct(p))

    // Enrich stock para la página actual. El mutex serializa internamente,
    // así que aunque hagamos Promise.all las requests salen una por una.
    const enriched = await Promise.all(mapped.map(enrichWithStock))

    return {
      items: enriched,
      total,
      offset,
      limit: effectiveLimit,
      hasMore: offset + effectiveLimit < total,
    }
  }

  async getProduct(
    credentials: DriverCredentials,
    externalId: string,
    config?: DriverConfig,
  ): Promise<MarketplaceProduct | null> {
    try {
      const client = await this.buildClient(credentials, config)
      // /v3/items/{sku} devuelve { ItemResponse: [{...}] } igual que la lista
      const res = await client.get(`/v3/items/${encodeURIComponent(externalId)}`)
      const data = res.data?.ItemResponse?.[0] ?? res.data
      if (!data) return null
      const mp = this.mapProduct(data)

      // Enrich stock desde /v3/inventory (no viene en /v3/items)
      try {
        const inv = await client.get(`/v3/inventory`, { params: { sku: externalId } })
        const amount = parseInt(inv.data?.quantity?.amount ?? '0', 10)
        if (Number.isFinite(amount)) mp.stock = amount
      } catch { /* item aún no listo para inventory */ }

      return mp
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
    try {
      const client = await this.buildClient(credentials, config)
      // GET /v3/inventory?sku=<sku> confirms the item exists in our catalog
      const res = await client.get('/v3/inventory', { params: { sku } })
      if (!res.data?.sku) return []
      // Fetch the full item record
      const item = await this.getProduct(credentials, sku, config)
      return item ? [item] : []
    } catch {
      return []
    }
  }

  // Construye un MPItem (Orderable + Visible) según el JSON schema oficial
  // MPItemFeed v4.46 que entregó Walmart Chile. Diferencias clave vs versiones
  // anteriores del driver:
  //   - `mart` correcto es "WALMART_CHILE" (NO "WALMART_CL").
  //   - `processMode`/`subset`/`sellingChannel`/`version` van en
  //     MPItemFeedHeader, no por item.
  //   - NO existe el wrapper `MPItemAndLocationGroups`: Orderable y Visible
  //     van directos dentro de cada MPItem.
  //   - `productIdentifiers` es objeto plano {productIdType, productId}, NO
  //     array bajo `productIdentifier`.
  //   - `price` es un número plano (CLP), NO objeto con currentPrice/currency.
  //   - `Visible` lleva como key el nombre de la subCategory (ej.
  //     "Accesorios Electrónicos") con sus atributos category-specific.
  //
  // Lo que el master de StockCentral provee va automático; los atributos
  // específicos del producto (garantías, dimensiones del producto armado,
  // color, etc.) vienen por formData del mapping (que el operador completa
  // al publicar).
  private buildMPItemPayload(product: Partial<SyncProductInput> & { formData?: Record<string, any> }): Record<string, any> {
    const fd: Record<string, any> = (product as any).formData ?? {}
    const [mainImage, ...additionalImages] = product.images ?? []
    const sku = String(fd.sku || product.sku || '')

    // ── Orderable: campos comunes de todo producto Walmart CL ────────────────
    const orderable: Record<string, any> = {
      sku,
      productName: fd.productName || product.title,
      brand: fd.brand || 'Sin marca',
      price: Number(fd.price ?? product.price ?? 0),
      productIdentifiers: {
        productIdType: fd.productIdType || 'GTIN',
        productId: String(fd.productId || (product as any).barcode || product.sku || ''),
      },
      // Imágenes
      ...(mainImage ? { mainImageUrl: mainImage } : {}),
      ...(additionalImages.length
        ? { productSecondaryImageURL: additionalImages.slice(0, 9) }
        : {}),
      // Fechas vigencia de la oferta en el sitio.
      startDate: fd.startDate || new Date().toISOString().slice(0, 10),
      endDate:
        fd.endDate ||
        new Date(Date.now() + 5 * 365 * 24 * 3600 * 1000).toISOString().slice(0, 10),
      countryOfOriginAssembly: fd.countryOfOriginAssembly || ['CN - China'],
      // Envío
      ShippingWeight: Number(fd.ShippingWeight ?? (product as any).weight ?? 1),
      ShippingDimensionsWidth: this.dim(fd.ShippingDimensionsWidth, (product as any).dimensions?.width ?? 15),
      shippingDimensionsHeight: this.dim(fd.shippingDimensionsHeight, (product as any).dimensions?.height ?? 15),
      ShippingDimensionsDepth: this.dim(fd.ShippingDimensionsDepth, (product as any).dimensions?.depth ?? 10),
      // Garantía / descripción / featuring obligatorios para publicar
      shortDescription: (fd.shortDescription || product.description || product.title || '').slice(0, 1000),
      keyFeatures: fd.keyFeatures || [(fd.shortDescription || product.title || 'Producto').slice(0, 80)],
      manufacturer: fd.manufacturer || fd.brand || 'Sin marca',
      condition: fd.condition || 'Nuevo',
      sellerWarrantyPeriod: fd.sellerWarrantyPeriod ?? 0,
      sellerWarrantyCondition: fd.sellerWarrantyCondition || 'En el caso de falla proceder a la devolución',
      warrantyText: fd.warrantyText || '6 meses',
      sellerWarranty: String(fd.sellerWarranty ?? '6'),
      // pricePerUnit obligatorio según la categoría — default a 1un.
      pricePerUnit: fd.pricePerUnit || {
        pricePerUnitQuantity: 1,
        pricePerUnitUom: 'un',
      },
    }

    // Campos Orderable opcionales si vienen
    if (fd.multipackQuantity) orderable.multipackQuantity = Number(fd.multipackQuantity)
    if (fd.electronicsIndicator) orderable.electronicsIndicator = fd.electronicsIndicator
    if (fd.batteryTechnologyType) orderable.batteryTechnologyType = fd.batteryTechnologyType
    if (fd.shipsInOriginalPackaging) orderable.shipsInOriginalPackaging = fd.shipsInOriginalPackaging
    if (fd.MustShipAlone) orderable.MustShipAlone = fd.MustShipAlone
    if (fd.externalProductIdentifier) orderable.externalProductIdentifier = fd.externalProductIdentifier
    if (fd.SkuUpdate) orderable.SkuUpdate = fd.SkuUpdate
    if (fd.ProductIdUpdate) orderable.ProductIdUpdate = fd.ProductIdUpdate

    // ── Visible: atributos category-specific anidados bajo el nombre de
    // la subCategory ("Accesorios Electrónicos", "Computadores", etc.). El
    // operador define la subcategoría y sus atributos en formData.Visible.
    // Si no vienen, dejamos un objeto mínimo con dimensiones del producto.
    const visible: Record<string, any> = fd.Visible || {}

    return { orderable, visible }
  }

  // Helper para construir un { measure, unit } a partir de un valor crudo o
  // un objeto ya formado.
  private dim(raw: any, fallbackMeasure: number): { measure: number; unit: string } {
    if (raw && typeof raw === 'object' && raw.measure !== undefined) {
      return { measure: Number(raw.measure), unit: String(raw.unit || 'cm') }
    }
    return { measure: Number(raw ?? fallbackMeasure), unit: 'cm' }
  }

  async createProduct(
    credentials: DriverCredentials,
    product: SyncProductInput,
    config?: DriverConfig,
  ): Promise<SyncResult> {
    try {
      const client = await this.buildClient(credentials, config)
      const fd: Record<string, any> = (product as any).formData ?? {}
      const { orderable, visible } = this.buildMPItemPayload(product)

      const feedPayload = this.buildFeedPayload({
        processMode: 'REPLACE',
        subCategory: fd.subCategory,
        item: { Orderable: orderable, Visible: visible },
      })

      const res = await client.post('/v3/feeds?feedType=MP_ITEM', feedPayload)

      // After creating, push initial stock via inventory API
      const qty = (product as any).formData?.availableQuantity ?? (product as any).availableQuantity
      if (qty !== undefined) {
        await this.updateStock(credentials, orderable.sku, Number(qty), config).catch(() => {})
      }

      return { success: true, externalId: orderable.sku, rawResponse: res.data }
    } catch (err: any) {
      return {
        success: false,
        error: err?.response?.data?.errors?.[0]?.description || err?.response?.data?.message || err.message,
        rawResponse: err?.response?.data,
      }
    }
  }

  // updateProduct (sync outbound del cron): para Walmart Chile, los updates
  // rutinarios de PRECIO usan el endpoint REST directo PUT /v3/price (no
  // feed). Es síncrono, rápido y no requiere subset/version/mart. Stock se
  // actualiza por separado vía updateStock() del cron.
  //
  // Los feeds MP_ITEM/MP_MAINTENANCE quedan reservados para changes
  // estructurales del catálogo (descripción, imágenes, atributos),
  // operaciones que sí justifican la asincronía del feed.
  //
  // Si el caller no pasa product.price, no hace nada (el cron también
  // empuja stock por separado).
  async updateProduct(
    credentials: DriverCredentials,
    externalId: string,
    product: Partial<SyncProductInput>,
    config?: DriverConfig,
  ): Promise<SyncResult> {
    if (product.price === undefined || product.price === null) {
      return { success: true, externalId, rawResponse: { skipped: 'no price provided' } }
    }
    return this.updatePriceDirect(credentials, externalId, Number(product.price), config)
  }

  // Construye el feed top-level con MPItemFeedHeader v4.46 obligatorio.
  // - processMode: REPLACE para crear, MERGE para update parcial.
  // - subset/sellingChannel/version/mart son enums fijos.
  // - subCategory es obligatorio del lado de Walmart pero depende de la
  //   subcategoría del producto. Lo aceptamos por formData del operador.
  private buildFeedPayload(opts: {
    processMode: 'REPLACE' | 'MERGE'
    subCategory?: string
    item: { Orderable: Record<string, any>; Visible: Record<string, any> }
  }): Record<string, any> {
    const header: Record<string, any> = {
      sellingChannel: 'marketplace',
      processMode: opts.processMode,
      mart: 'WALMART_CHILE',
      subset: 'EXTERNAL',
      locale: 'es',
      version: '4.46',
      requestId: randomUUID(),
      feedDate: new Date().toISOString(),
    }
    if (opts.subCategory) header.subCategory = opts.subCategory
    return {
      MPItemFeedHeader: header,
      MPItem: [opts.item],
    }
  }

  // POST /v3/feeds?feedType=MP_ITEM con archivo Excel via multipart/form-data.
  // Es la misma vía que el Sellercenter portal usa cuando subes un .xlsx
  // manualmente. La API acepta tanto JSON como multipart; el multipart con
  // un Excel bien armado (el mismo que sabemos funciona desde el portal) es
  // la opción más confiable porque no requiere reverse-engineering del JSON.
  async uploadItemFeedExcel(
    credentials: DriverCredentials,
    fileBuffer: Buffer,
    filename: string,
    config?: DriverConfig,
  ): Promise<any> {
    const client = await this.buildClient(credentials, config)
    // FormData global (Node 18+ undici)
    const fd = new FormData()
    const blob = new Blob([fileBuffer as any], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    fd.append('file', blob, filename)
    try {
      const res = await client.post('/v3/feeds?feedType=MP_ITEM', fd, {
        // axios + Node FormData: dejar que axios infiera el boundary correcto.
        headers: { 'Content-Type': undefined as any },
        maxBodyLength: 25 * 1024 * 1024, // 25 MB
      })
      return { success: true, data: res.data }
    } catch (err: any) {
      return {
        success: false,
        status: err?.response?.status,
        error: err?.response?.data || err.message,
      }
    }
  }

  // POST /v3/items/spec — descubre las specs disponibles para un feedType.
  async getItemSpec(
    credentials: DriverCredentials,
    feedType: string,
    config?: DriverConfig,
    version = '5.0',
    productTypes: string[] = ['Computers'],
  ): Promise<any> {
    const client = await this.buildClient(credentials, config)
    try {
      const res = await client.post('/v3/items/spec', {
        feedType,
        version,
        productTypes,
      })
      return { success: true, data: res.data }
    } catch (err: any) {
      return {
        success: false,
        status: err?.response?.status,
        error: err?.response?.data || err.message,
      }
    }
  }

  // POST /v3/feeds?feedType=MP_ITEM con payload literal — para enviar el
  // ejemplo EXACTO que Walmart documenta y descartar cualquier diferencia
  // del shape v4.46 generado por buildMPItemPayload. Si esto procesa OK,
  // sabemos que el problema NO es el feedType ni el shape sino algún
  // campo derivado del producto local; si esto también falla, el problema
  // es del lado de Walmart (cuenta sin WM_SPEC_MODE activado).
  async diagRawFeed(
    credentials: DriverCredentials,
    feedType: string,
    body: any,
    config?: DriverConfig,
  ): Promise<any> {
    const client = await this.buildClient(credentials, config)
    try {
      const res = await client.post(`/v3/feeds?feedType=${encodeURIComponent(feedType)}`, body)
      return { success: true, data: res.data }
    } catch (err: any) {
      return {
        success: false,
        status: err?.response?.status,
        error: err?.response?.data || err.message,
      }
    }
  }

  // PUT /v3/price — actualiza el precio normal de uno o varios SKUs.
  // Endpoint REST dedicado (síncrono, no es feed async).
  // Doc CL: https://developer.walmart.com/cl-marketplace/reference/updateprice
  //
  // El shape de Walmart Chile es DISTINTO al de US:
  //   - US: {sku, pricing: [{currentPriceType, currentPrice: {currency, amount}}]}
  //   - CL: {amount: "29.99", skus: ["SKU1", "SKU2"]}  ← amount como STRING
  //
  // Validado contra la API real: Walmart CL rechaza `sku`, `pricing`,
  // `price`, `currentPrice`. El DTO ItemPriceUpdateRequestDTO solo acepta
  // los campos `amount` (string) y `skus` (array).
  async updatePriceDirect(
    credentials: DriverCredentials,
    sku: string,
    price: number,
    config?: DriverConfig,
  ): Promise<SyncResult> {
    try {
      const client = await this.buildClient(credentials, config)
      const payload = {
        amount: String(Math.round(price)), // CL no acepta decimales y amount va como string
        skus: [sku],
      }
      const res = await client.put('/v3/price', payload)
      return { success: true, externalId: sku, rawResponse: res.data }
    } catch (err: any) {
      return {
        success: false,
        error: err?.response?.data?.errors?.[0]?.description || err?.response?.data?.message || err.message,
        rawResponse: err?.response?.data,
      }
    }
  }

  // POST /v3/feeds?feedType=inventory — actualización masiva de stock.
  // Walmart Chile acepta hasta 1000 SKUs por feed. El feed se procesa
  // async: el POST devuelve feedId al toque, hay que consultar el feed
  // status después para saber cuántos aceptó/rechazó.
  //
  // Shape validado en probe-lider-inventory-feed.cjs:
  //   { InventoryHeader: { version: '1.4' }, Inventory: [{sku, quantity:{unit,amount}}, ...] }
  //
  // Devolvemos { feedId, count } al caller. La verificación del status
  // del feed queda en manos del caller (sync.service decide cuándo
  // consultarlo).
  async bulkUpdateStock(
    credentials: DriverCredentials,
    items: Array<{ sku: string; stock: number }>,
    config?: DriverConfig,
  ): Promise<{ success: boolean; feedId?: string; count?: number; error?: string }> {
    if (!items.length) return { success: true, count: 0 }
    try {
      const client = await this.buildClient(credentials, config)
      // Walmart capea en 1000 por feed; si vienen más, dividimos en chunks.
      const CHUNK = 1000
      const chunks: Array<typeof items> = []
      for (let i = 0; i < items.length; i += CHUNK) chunks.push(items.slice(i, i + CHUNK))

      const feedIds: string[] = []
      for (const chunk of chunks) {
        const payload = {
          InventoryHeader: { version: '1.4' },
          Inventory: chunk.map((it) => ({
            sku: it.sku,
            quantity: { unit: 'EACH', amount: Math.max(0, Math.floor(it.stock)) },
          })),
        }
        const res = await client.post('/v3/feeds?feedType=inventory', payload)
        const fid = res.data?.feedId
        if (fid) feedIds.push(fid)
      }
      // Si hubo 1 solo feed devolvemos su id directo; si hubo varios, los
      // unimos por coma (poco común — sería >1000 SKUs).
      return {
        success: feedIds.length > 0,
        feedId: feedIds.join(','),
        count: items.length,
      }
    } catch (err: any) {
      return {
        success: false,
        error: err?.response?.data?.errors?.[0]?.description || err?.response?.data?.message || err.message,
      }
    }
  }

  // PUT /v3/price con array de SKUs — actualización masiva de precio.
  // Walmart CL solo acepta el MISMO precio para todos los SKUs del array,
  // así que el caller debe agrupar por precio antes de llamar a esta
  // función. Devolvemos un resumen con el total de SKUs actualizados.
  //
  // OPTIMIZACIÓN: el endpoint /v3/price es muy liviano y Walmart tolera
  // burst de 10-20 requests sin 429 (los caps de rate-limit aplican a
  // /v3/inventory PUT y /v3/items GET, NO al PUT /v3/price). Bypaseamos
  // el mutex normal del driver creando un cliente nuevo SIN throttle —
  // sino 56 grupos × 500ms = 28s solo en mutex.
  async bulkUpdatePrice(
    credentials: DriverCredentials,
    groups: Array<{ price: number; skus: string[] }>,
    config?: DriverConfig,
  ): Promise<{
    success: boolean
    updated: number
    failed: number
    errors: string[]
    failedSkus: string[] // SKUs específicos que NO se aplicaron — el caller los excluye del snapshot update
  }> {
    if (!groups.length) return { success: true, updated: 0, failed: 0, errors: [], failedSkus: [] }
    // Cliente axios "fast" — usa el token cacheado pero sin el mutex de
    // 500ms entre requests. Solo lo usamos para PUT /v3/price que es
    // idempotente y Walmart no aplica throttle agresivo en él.
    const { clientId, clientSecret } = this.getClientCredentials(credentials, config)
    const token = await this.getAccessToken(credentials, config)
    const encoded = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    // fastClient: pasa el token cacheado y todos los headers obligatorios de
    // Walmart Chile. Necesita WM_QOS.CORRELATION_ID (sin él Walmart trata las
    // requests como sospechosas → más 429). Se regenera por cada request en
    // el interceptor de abajo para tener un UUID único por PUT.
    const fastClient = axios.create({
      baseURL: this.getBaseUrl(config),
      timeout: 30000,
      headers: {
        Authorization: `Basic ${encoded}`,
        'WM_SEC.ACCESS_TOKEN': token,
        'WM_MARKET': 'cl',
        'WM_SVC.NAME': 'Walmart Marketplace',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    })
    fastClient.interceptors.request.use((cfg) => {
      cfg.headers['WM_QOS.CORRELATION_ID'] = randomUUID()
      return cfg
    })

    let updated = 0
    let failed = 0
    const errors: string[] = []
    const failedSkus: string[] = []

    // Walmart Chile aplica rate-limit muy estricto a PUT /v3/price:
    // con CONCURRENCY=2 + backoff 1s/2s/4s, 73% de 196 requests dieron 429.
    // Pasamos a SECUENCIAL (CONCURRENCY=1) + backoff agresivo (5/15/45/120s
    // × 5 retries) para dejar que Walmart libere el bucket entre intentos.
    // Tiempo esperado: 196 precios × ~600ms = ~2 min en happy path. Si hay
    // 429, cada uno espera 5s mínimo. El bucket se libera y el 99% pasa al
    // segundo retry.
    const CONCURRENCY = 1
    const MAX_RETRIES = 5
    const BACKOFF_MS = [5000, 15000, 45000, 120000, 300000]
    const queue = [...groups]
    async function putWithRetry(g: { price: number; skus: string[] }, attempt = 0): Promise<void> {
      try {
        await fastClient.put('/v3/price', {
          amount: String(Math.round(g.price)),
          skus: g.skus,
        })
        updated += g.skus.length
      } catch (err: any) {
        const status = err?.response?.status
        if (status === 429 && attempt < MAX_RETRIES) {
          const retryAfter = parseFloat(err.response.headers?.['retry-after'] ?? '')
          const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.max(retryAfter * 1000, BACKOFF_MS[attempt])
            : BACKOFF_MS[attempt]
          await new Promise((r) => setTimeout(r, waitMs))
          return putWithRetry(g, attempt + 1)
        }
        failed += g.skus.length
        failedSkus.push(...g.skus)
        const msg = err?.response?.data?.errors?.[0]?.description || err?.response?.data?.message || err.message
        // Loguear cada fallo individual con sku+price para poder hacer retry
        // incremental fuera del batch (script de convergencia, debugging).
        errors.push(`price=${g.price} skus=[${g.skus.join(',')}]: ${msg}`)
      }
    }
    async function worker() {
      while (queue.length) {
        const g = queue.shift()
        if (!g || !g.skus.length) continue
        await putWithRetry(g)
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
    return { success: failed === 0, updated, failed, errors, failedSkus }
  }

  // GET /v3/inventory?sku=<sku> — estado actual del inventario de un SKU.
  // Sirve para verificar si updateStock realmente aplicó.
  async getStock(
    credentials: DriverCredentials,
    sku: string,
    config?: DriverConfig,
  ): Promise<any> {
    const client = await this.buildClient(credentials, config)
    try {
      const res = await client.get(`/v3/inventory?sku=${encodeURIComponent(sku)}`)
      return { success: true, data: res.data }
    } catch (err: any) {
      return {
        success: false,
        status: err?.response?.status,
        error: err?.response?.data || err.message,
      }
    }
  }

  // GET /v3/feeds/{feedId}?includeDetails=true — estado real de un feed
  // específico (los feeds se procesan async; el POST inicial siempre devuelve
  // 200 con un feedId, lo que importa es el feedStatus después).
  async getFeedStatus(
    credentials: DriverCredentials,
    feedId: string,
    config?: DriverConfig,
  ): Promise<any> {
    const client = await this.buildClient(credentials, config)
    try {
      const res = await client.get(`/v3/feeds/${encodeURIComponent(feedId)}?includeDetails=true`)
      return { success: true, data: res.data }
    } catch (err: any) {
      return {
        success: false,
        status: err?.response?.status,
        error: err?.response?.data || err.message,
      }
    }
  }

  // GET /v3/feeds?limit=N — historial reciente. Útil para ver el contexto
  // de feeds rechazados.
  async listRecentFeeds(
    credentials: DriverCredentials,
    config?: DriverConfig,
    limit = 10,
  ): Promise<any> {
    const client = await this.buildClient(credentials, config)
    try {
      const res = await client.get(`/v3/feeds?limit=${limit}&offset=0`)
      return { success: true, data: res.data }
    } catch (err: any) {
      return {
        success: false,
        status: err?.response?.status,
        error: err?.response?.data || err.message,
      }
    }
  }

  // ─── Stock ───────────────────────────────────────────────────────────────────

  // PUT /v3/inventory?sku=<sku> — updates inventory for a single SKU.
  async updateStock(
    credentials: DriverCredentials,
    externalId: string,
    stock: number,
    config?: DriverConfig,
  ): Promise<SyncResult> {
    try {
      const client = await this.buildClient(credentials, config)
      const payload = {
        sku: externalId,
        quantity: {
          unit: 'EACH',
          amount: stock,
        },
      }
      const res = await client.put(`/v3/inventory?sku=${encodeURIComponent(externalId)}`, payload)
      return { success: true, externalId, rawResponse: res.data }
    } catch (err: any) {
      return {
        success: false,
        error: err?.response?.data?.errors?.[0]?.description || err?.response?.data?.message || err.message,
      }
    }
  }

  // ─── Orders ──────────────────────────────────────────────────────────────────

  async getOrders(
    credentials: DriverCredentials,
    config?: DriverConfig,
    since?: Date,
    offset = 0,
    limit = 50,
  ): Promise<PaginatedResult<MarketplaceOrder>> {
    const client = await this.buildClient(credentials, config)
    const params: Record<string, unknown> = {
      limit,
      // Walmart requires createdStartDate — default to 30 days ago if not provided
      createdStartDate: (since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
        .toISOString()
        .slice(0, 10),
    }
    if (offset > 0) params.cursor = String(offset)

    const res = await client.get('/v3/orders', { params })
    const orderElements = res.data?.list?.elements?.order || []
    const total = res.data?.list?.meta?.totalCount ?? orderElements.length

    return {
      items: orderElements.map((o: any) => this.mapOrder(o)),
      total,
      offset,
      limit,
      hasMore: !!res.data?.list?.meta?.nextCursor,
    }
  }

  async getOrder(
    credentials: DriverCredentials,
    externalId: string,
    config?: DriverConfig,
  ): Promise<MarketplaceOrder | null> {
    try {
      const client = await this.buildClient(credentials, config)
      const res = await client.get(`/v3/orders/${encodeURIComponent(externalId)}`)
      const order = res.data?.order
      return order ? this.mapOrder(order) : null
    } catch {
      return null
    }
  }

  // confirmOrder acknowledges a purchase order (required before shipping).
  async confirmOrder(
    credentials: DriverCredentials,
    externalId: string,
    config?: DriverConfig,
  ): Promise<SyncResult> {
    try {
      const client = await this.buildClient(credentials, config)
      await client.post(`/v3/orders/${encodeURIComponent(externalId)}/acknowledge`)
      return { success: true, externalId }
    } catch (err: any) {
      return {
        success: false,
        error: err?.response?.data?.errors?.[0]?.description || err?.response?.data?.message || err.message,
      }
    }
  }

  // ─── Mappers ─────────────────────────────────────────────────────────────────

  private mapProduct(data: any): MarketplaceProduct {
    // Walmart Chile /v3/items shape verificado con curl:
    //   { mart, sku, wpid, upc, gtin, productName, shelf, productType,
    //     price: { currency, amount }, publishedStatus }
    // /v3/items NO devuelve inventory ni images — stock se enriquece por
    // /v3/inventory?sku=X en el caller; imágenes hoy quedan vacías
    // (Walmart no expone galería en /v3/items y /v3/items/:sku tampoco
    // las trae siempre — pendiente de descubrir endpoint específico).
    const price =
      parseFloat(
        data.price?.amount ??
        data.price?.currentPrice?.amount ??
        data.price?.currentPrice?.value ??
        '0',
      ) || 0

    // Inventory enrichment se hace en getProducts/getProduct; aquí solo
    // leemos lo que venga incluido (caso /v3/items/:sku puede tener inventory)
    const stock = parseInt(
      data.inventory?.quantity?.amount ??
      data.inventory?.availableToSellQty ??
      data.availableToSellQty ??
      '0',
      10,
    ) || 0

    const images: string[] = []
    if (data.images?.image) {
      const imageList = Array.isArray(data.images.image) ? data.images.image : [data.images.image]
      imageList.forEach((img: any) => {
        const url = img?.assetUrl || img?.url
        if (url) images.push(url)
      })
    }
    if (!images.length && data.imageUrl) images.push(data.imageUrl)
    if (!images.length && data.mainImageUrl) images.push(data.mainImageUrl)

    return {
      externalId: String(data.sku || data.itemId || data.wpid),
      externalSku: data.sku,
      title: data.productName || data.itemDescription?.shortDescription || '',
      description: data.itemDescription?.longDescription,
      price,
      stock,
      images,
      categoryId: data.category,
      status: this.mapProductStatus(data.publishedStatus || data.status),
      rawData: data,
    }
  }

  private mapProductStatus(status?: string): MarketplaceProduct['status'] {
    const s = (status || '').toUpperCase()
    if (s === 'PUBLISHED' || s === 'ACTIVE') return 'active'
    if (s === 'UNPUBLISHED' || s === 'RETIRED') return 'closed'
    if (s === 'STAGE' || s === 'IN_PROGRESS') return 'paused'
    return 'unknown'
  }

  private mapOrder(data: any): MarketplaceOrder {
    // Walmart order shape: { purchaseOrderId, customerOrderId, orderDate, shippingInfo,
    //   orderLines: { orderLine: [...] }, customerEmailId, ... }
    const lines: any[] = data.orderLines?.orderLine
      ? Array.isArray(data.orderLines.orderLine)
        ? data.orderLines.orderLine
        : [data.orderLines.orderLine]
      : []

    const shipping = data.shippingInfo || {}
    const postalAddress = shipping.postalAddress || {}
    const buyerName = postalAddress.name || data.customerName || 'Unknown'

    const subtotal = lines.reduce((sum: number, line: any) => {
      const charges = line.charges?.charge
      if (!charges) return sum
      const chargeList = Array.isArray(charges) ? charges : [charges]
      const productCharge = chargeList.find((c: any) => c.chargeType === 'PRODUCT')
      return sum + parseFloat(productCharge?.chargeAmount?.amount || '0')
    }, 0)

    const shippingCost = lines.reduce((sum: number, line: any) => {
      const charges = line.charges?.charge
      if (!charges) return sum
      const chargeList = Array.isArray(charges) ? charges : [charges]
      const shippingCharge = chargeList.find((c: any) => c.chargeType === 'SHIPPING')
      return sum + parseFloat(shippingCharge?.chargeAmount?.amount || '0')
    }, 0)

    return {
      externalId: String(data.purchaseOrderId),
      externalOrderNumber: String(data.customerOrderId || data.purchaseOrderId),
      packId: data.purchaseOrderId,
      status: this.mapOrderStatus(data.orderLines?.orderLine),
      buyerName,
      buyerEmail: data.customerEmailId,
      buyerPhone: postalAddress.phone,
      shippingAddress: postalAddress.name
        ? {
            name: postalAddress.name,
            address1: postalAddress.address1 || '',
            address2: postalAddress.address2,
            city: postalAddress.city || '',
            state: postalAddress.state,
            zipCode: postalAddress.postalCode,
            country: postalAddress.country || 'CL',
            phone: postalAddress.phone,
          }
        : undefined,
      items: lines.map((line: any) => {
        const charges = line.charges?.charge
        const chargeList = charges ? (Array.isArray(charges) ? charges : [charges]) : []
        const productCharge = chargeList.find((c: any) => c.chargeType === 'PRODUCT')
        const unitPrice = parseFloat(productCharge?.chargeAmount?.amount || '0')
        const qty = parseInt(line.orderLineQuantity?.amount || '1', 10)
        return {
          externalId: String(line.lineNumber),
          sku: line.item?.sku || '',
          title: line.item?.productName || '',
          quantity: qty,
          unitPrice,
          totalPrice: unitPrice * qty,
        }
      }),
      subtotal,
      shippingCost,
      total: subtotal + shippingCost,
      currency: 'CLP',
      billing: { invoiceType: 'boleta' },
      createdAt: new Date(data.orderDate || Date.now()),
      updatedAt: new Date(data.lastModifiedDate || data.orderDate || Date.now()),
      rawData: data,
    }
  }

  private mapOrderStatus(orderLines: any): string {
    // Derive overall status from line statuses.
    // Walmart line statuses: Created, Acknowledged, Shipped, Cancelled
    const lines = Array.isArray(orderLines) ? orderLines : orderLines ? [orderLines] : []
    if (!lines.length) return 'pending'

    const statuses = lines.map((l: any) =>
      (l.orderLineStatuses?.orderLineStatus?.[0]?.status || l.status || '').toLowerCase(),
    )

    if (statuses.every((s) => s === 'cancelled')) return 'cancelled'
    if (statuses.some((s) => s === 'shipped')) return 'fulfilled'
    if (statuses.some((s) => s === 'acknowledged')) return 'confirmed'
    return 'pending'
  }
}
