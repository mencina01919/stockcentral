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
export class LiderDriver implements IMarketplaceDriver {
  readonly provider = 'lider'

  // Token cache keyed by clientId. Token expires in 15 min; we refresh at <2 min.
  private tokenCache = new Map<string, { token: string; expiresAt: number }>()

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
    return axios.create({
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
    const cfg = (config || {}) as Record<string, any>

    // If caller wants all products (limit >= 9999), iterate all pages via nextCursor
    if (limit >= 9999) {
      const allItems: MarketplaceProduct[] = []
      let nextCursor: string | undefined
      let total = 0

      do {
        const params: Record<string, any> = { limit: 200 }
        if (nextCursor) params.nextCursor = nextCursor
        const res = await client.get('/v3/items', { params })
        const batch = res.data?.ItemResponse || []
        total = res.data?.totalItems ?? (allItems.length + batch.length)
        for (const p of batch) allItems.push(this.mapProduct(p))
        nextCursor = res.data?.nextCursor
      } while (nextCursor)

      // Apply pagination slice in memory
      const page = allItems.slice(offset, offset + 9999)
      return { items: page, total: allItems.length, offset, limit, hasMore: false }
    }

    // Standard paginated call (used when browsing without caching)
    const params: Record<string, any> = { limit }
    if (offset > 0) params.offset = offset
    const res = await client.get('/v3/items', { params })
    const items = res.data?.ItemResponse || []
    const total = res.data?.totalItems ?? items.length

    return {
      items: items.map((p: any) => this.mapProduct(p)),
      total,
      offset,
      limit,
      hasMore: offset + limit < total,
    }
  }

  async getProduct(
    credentials: DriverCredentials,
    externalId: string,
    config?: DriverConfig,
  ): Promise<MarketplaceProduct | null> {
    try {
      const client = await this.buildClient(credentials, config)
      const res = await client.get(`/v3/items/${encodeURIComponent(externalId)}`)
      return res.data ? this.mapProduct(res.data) : null
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
    // Walmart item shape: { sku, productName, status, price, inventory, images }
    const price = parseFloat(data.price?.currentPrice?.amount || data.price?.currentPrice?.value || '0') || 0
    const stock = parseInt(data.inventory?.quantity?.amount || '0', 10) || 0

    const images: string[] = []
    if (data.images?.image) {
      const imageList = Array.isArray(data.images.image) ? data.images.image : [data.images.image]
      imageList.forEach((img: any) => {
        const url = img?.assetUrl || img?.url
        if (url) images.push(url)
      })
    }
    if (!images.length && data.imageUrl) images.push(data.imageUrl)

    return {
      externalId: String(data.sku || data.itemId),
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
