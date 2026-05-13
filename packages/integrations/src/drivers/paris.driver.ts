import axios, { AxiosInstance } from 'axios'
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

// Paris Marketplace = Cencosud Seller Center (covers paris.cl, easy.cl, jumbo.cl, etc.)
// Docs: https://developers.ecomm.cencosud.com/
const PROD_BASE = 'https://api-developers.ecomm.cencosud.com'
const STAGING_BASE = 'https://api-developers.ecomm-stg.cencosud.com'

/**
 * Paris (Cencosud) Marketplace driver.
 *
 * Auth: 2-step. Send API Key to /v1/auth/apiKey to receive a JWT access token
 * that lasts 4 hours. Cache it across calls.
 *
 * Credentials:
 *   - apiKey:    API Key from Seller Center → Mi Cuenta (admin user)
 *   - sellerId?: optional — populated from token after first auth
 *
 * Config:
 *   - staging?:  true to use staging environment
 */
export interface ParisAttributeValue {
  id: string
  value: string | number | boolean
}

export interface ParisVariantInput {
  sellerSku: string
  medias?: Array<{ position?: number; src: string }>
  attributes?: ParisAttributeValue[]
}

export interface ParisPriceInput {
  priceTypeId: string
  value: number
  startDate?: string
  endDate?: string
}

export interface ParisPublishInput {
  name: string
  sellerSku: string
  familyId: string
  categoryId: string
  productAttributes?: ParisAttributeValue[]
  variants?: ParisVariantInput[]
  images?: string[]
  prices?: ParisPriceInput[]
}

export class ParisDriver implements IMarketplaceDriver {
  readonly provider = 'paris'

  // In-memory token cache keyed by API key. The JWT expires after 4h —
  // we refresh proactively when there's <5 min left.
  private tokenCache = new Map<string, { token: string; expiresAt: number; sellerId?: string }>()

  private getBaseUrl(config?: DriverConfig): string {
    return config?.staging === true ? STAGING_BASE : PROD_BASE
  }

  private async getAccessToken(credentials: DriverCredentials, config?: DriverConfig): Promise<string> {
    const apiKey = credentials.apiKey
    if (!apiKey) throw new Error('Paris driver: missing apiKey in credentials')

    const cached = this.tokenCache.get(apiKey)
    if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) {
      return cached.token
    }

    const baseUrl = this.getBaseUrl(config)
    const res = await axios.post(
      `${baseUrl}/v1/auth/apiKey`,
      {},
      { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } },
    )

    const accessToken = res.data?.accessToken
    const expiresIn = parseInt(res.data?.expiresIn || '14400', 10) // seconds
    const sellerId = res.data?.jwtPayload?.seller_id

    if (!accessToken) throw new Error('Paris driver: no accessToken in auth response')

    this.tokenCache.set(apiKey, {
      token: accessToken,
      expiresAt: Date.now() + expiresIn * 1000,
      sellerId,
    })
    return accessToken
  }

  private async buildClient(credentials: DriverCredentials, config?: DriverConfig): Promise<AxiosInstance> {
    const token = await this.getAccessToken(credentials, config)
    return axios.create({
      baseURL: this.getBaseUrl(config),
      timeout: 30000,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
  }

  // ─── testConnection ─────────────────────────────────────────────────────────

  async testConnection(credentials: DriverCredentials, config?: DriverConfig): Promise<ConnectionTestResult> {
    try {
      // Auth itself proves the API key works and returns seller info.
      await this.getAccessToken(credentials, config)
      const cached = this.tokenCache.get(credentials.apiKey)
      return {
        success: true,
        sellerId: cached?.sellerId,
        shopName: cached?.sellerId,
      }
    } catch (err: any) {
      return {
        success: false,
        error: err?.response?.data?.message || err.message,
      }
    }
  }

  // ─── Products ───────────────────────────────────────────────────────────────

  async getProducts(
    credentials: DriverCredentials,
    config?: DriverConfig,
    offset = 0,
    limit = 25,
  ): Promise<PaginatedResult<MarketplaceProduct>> {
    const client = await this.buildClient(credentials, config)

    // Paris API tiene cap interno; con limit grande (ej. 9999) responde
    // 400. Usamos páginas de 100. Si el caller pide 9999 (modo "todos"
    // que usa el cache refresh) iteramos hasta agotar.
    const PAGE_SIZE = 100

    if (limit >= 9999) {
      const allItems: MarketplaceProduct[] = []
      let pageOffset = 0
      let total = 0
      while (true) {
        const res = await client.get('/v2/products/search', {
          params: { limit: PAGE_SIZE, offset: pageOffset },
        })
        const batch = res.data?.results || []
        total = res.data?.total ?? (allItems.length + batch.length)
        for (const p of batch) allItems.push(this.mapProduct(p))
        if (batch.length < PAGE_SIZE || allItems.length >= total) break
        pageOffset += PAGE_SIZE
      }
      return {
        items: allItems,
        total: allItems.length,
        offset: 0,
        limit: allItems.length,
        hasMore: false,
      }
    }

    const effectiveLimit = Math.min(limit, PAGE_SIZE)
    const res = await client.get('/v2/products/search', {
      params: { limit: effectiveLimit, offset },
    })
    const results = res.data?.results || []
    const total = res.data?.total ?? results.length
    return {
      items: results.map((p: any) => this.mapProduct(p)),
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
      const res = await client.get(`/v2/products/${encodeURIComponent(externalId)}`)
      return res.data ? this.mapProduct(res.data) : null
    } catch {
      return null
    }
  }

  // findBySku uses the search endpoint with REF_ID typeFilter (= sellerSku).
  async findBySku(
    credentials: DriverCredentials,
    sku: string,
    config?: DriverConfig,
  ): Promise<MarketplaceProduct[]> {
    if (!sku) return []
    try {
      const client = await this.buildClient(credentials, config)
      const res = await client.get('/v2/products/search', {
        params: { identifier: sku, typeFilter: 'REF_ID', limit: 25, offset: 0 },
      })
      const results = res.data?.results || []
      return results.map((p: any) => this.mapProduct(p))
    } catch {
      return []
    }
  }

  // Paris API helpers — exposed as raw passthroughs so the backend can build
  // the editor UI (families, categories, attributes, options, price types).

  async listFamilies(credentials: DriverCredentials, config?: DriverConfig, offset = 0, limit = 200) {
    const client = await this.buildClient(credentials, config)
    const res = await client.get('/v2/families', { params: { limit, offset } })
    return res.data
  }

  async listCategories(credentials: DriverCredentials, familyId: string, config?: DriverConfig, offset = 0, limit = 200) {
    const client = await this.buildClient(credentials, config)
    const res = await client.get(`/v2/categories/family/${familyId}`, { params: { limit, offset } })
    return res.data
  }

  async listProductAttributes(credentials: DriverCredentials, familyId: string, config?: DriverConfig) {
    const client = await this.buildClient(credentials, config)
    const res = await client.get(`/v2/attributes/product/family/${familyId}`, { params: { limit: 200, offset: 0 } })
    return res.data
  }

  async listVariantAttributes(credentials: DriverCredentials, familyId: string, config?: DriverConfig) {
    const client = await this.buildClient(credentials, config)
    const res = await client.get(`/v2/attributes/variant/family/${familyId}`, { params: { limit: 200, offset: 0 } })
    return res.data
  }

  async listAttributeOptions(
    credentials: DriverCredentials,
    attributeId: string,
    config?: DriverConfig,
    q?: string,
  ) {
    const client = await this.buildClient(credentials, config)
    const params: Record<string, unknown> = { limit: 200, offset: 0 }
    if (q) params.q = q
    const res = await client.get(`/v2/attributes-options/attribute/${attributeId}`, { params })
    return res.data
  }

  async listPriceTypes(credentials: DriverCredentials, config?: DriverConfig) {
    const client = await this.buildClient(credentials, config)
    const res = await client.get('/v2/price-types')
    return res.data
  }

  async createProduct(
    credentials: DriverCredentials,
    product: SyncProductInput,
    config?: DriverConfig,
  ): Promise<SyncResult> {
    // Bridge from the generic SyncProductInput (used by the unified /publications endpoint)
    // to Paris-specific publish(). The UI builds these fields into formData.
    const fd: Record<string, any> = (product as any).formData ?? (product as any)
    if (!fd.familyId || !fd.categoryId) {
      return {
        success: false,
        error: 'Faltan campos obligatorios para Paris: familyId y categoryId',
      }
    }

    // Map dynamic attribute keys (paris_attr_<id> = { id, value }) into productAttributes / variantAttributes
    const productAttributes: ParisAttributeValue[] = []
    const variantAttributes: ParisAttributeValue[] = []
    for (const [key, val] of Object.entries(fd)) {
      if (val == null || val === '') continue
      if (key.startsWith('paris_pattr_')) {
        const a = val as any
        if (a?.id && (a.value ?? a.value_id) !== undefined) {
          productAttributes.push({ id: a.id, value: a.value ?? a.value_id })
        }
      } else if (key.startsWith('paris_vattr_')) {
        const a = val as any
        if (a?.id && (a.value ?? a.value_id) !== undefined) {
          variantAttributes.push({ id: a.id, value: a.value ?? a.value_id })
        }
      }
    }

    // Prices array from formData: [{ priceTypeId, value, startDate?, endDate? }]
    let prices: ParisPriceInput[] | undefined
    if (Array.isArray(fd.parisPrices)) {
      prices = fd.parisPrices
        .filter((p: any) => p?.priceTypeId && p?.value)
        .map((p: any) => ({
          priceTypeId: p.priceTypeId,
          value: Number(p.value),
          startDate: p.startDate || undefined,
          endDate: p.endDate || undefined,
        }))
    } else if (typeof product.price === 'number') {
      // Fallback: a single "Precio" entry using the first price-type configured
      // The caller can provide fd.parisDefaultPriceTypeId to specify which type
      if (fd.parisDefaultPriceTypeId) {
        prices = [{ priceTypeId: fd.parisDefaultPriceTypeId, value: product.price }]
      }
    }

    return this.publish(
      credentials,
      {
        name: fd.name || product.title,
        sellerSku: fd.sellerSku || product.sku,
        familyId: fd.familyId,
        categoryId: fd.categoryId,
        productAttributes,
        variants: variantAttributes.length
          ? [{
              sellerSku: fd.sellerSku || product.sku,
              attributes: variantAttributes,
              medias: (product.images || []).map((url, i) => ({ position: i + 1, src: url })),
            }]
          : undefined,
        images: product.images || [],
        prices,
        // Pass initial stock through publish — driver pushes to /v2/stock per variant
        ...(typeof product.stock === 'number' ? { initialStock: product.stock } : {}),
      } as any,
      config,
    )
  }

  async publish(
    credentials: DriverCredentials,
    input: ParisPublishInput,
    config?: DriverConfig,
  ): Promise<SyncResult> {
    try {
      const client = await this.buildClient(credentials, config)

      // Paris API shape (verified against official Redoc):
      //   POST /v2/products → { product: {name, sellerSku, familyId, category, attributes[]},
      //                          variants: [{ skuSeller, medias[], attributes[] }],
      //                          prices?: [{ ... }] }
      //   variants[].skuSeller (NOT sellerSku — API is asymmetric)
      //   attributes shape: [{ id, value }] where value is the optionId for LIST attributes
      //
      // Prices and stock are pushed separately AFTER creation:
      //   POST /v2/prices/product/{sellerSku}  body { prices: [{ priceType, value, ... }] }
      //   POST /v2/stock  body { skus: [{ sku: <variantMarketplaceSku>, quantity }] }
      const variantAttributes = (input.variants?.[0]?.attributes || []).map((a) => ({
        id: a.id,
        value: String(a.value),
      }))

      const variants =
        input.variants && input.variants.length > 0
          ? input.variants
          : [
              {
                sellerSku: input.sellerSku,
                medias: (input.images || []).map((url, i) => ({ position: i + 1, src: url })),
                attributes: variantAttributes,
              },
            ]

      const payload: Record<string, unknown> = {
        product: {
          name: input.name,
          sellerSku: input.sellerSku,
          familyId: input.familyId,
          category: input.categoryId,
          attributes: (input.productAttributes || []).map((a) => ({
            id: a.id,
            value: String(a.value),
          })),
        },
        variants: variants.map((v) => ({
          skuSeller: (v.sellerSku || input.sellerSku).slice(0, 50),
          medias:
            v.medias && v.medias.length > 0
              ? v.medias
              : (input.images || []).map((url, i) => ({ position: i + 1, src: url })),
          attributes: (v.attributes && v.attributes.length > 0
            ? v.attributes
            : variantAttributes
          ).map((a) => ({ id: a.id, value: String(a.value) })),
        })),
      }

      const res = await client.post('/v2/products', payload)
      const productId: string = res.data?.id
      const createdVariants: any[] = res.data?.variants || []

      const warnings: string[] = []
      const cfg = (config || {}) as Record<string, any>
      const storeId: string | undefined = cfg.storeId

      // Push prices keyed by the marketplace product ID (NOT sellerSku)
      if (input.prices && input.prices.length > 0 && productId) {
        if (!storeId) {
          warnings.push('precios: falta storeId en config de la conexión Paris')
        } else {
          try {
            await this.uploadPrices(client, productId, storeId, input.prices)
          } catch (err: any) {
            warnings.push(`precios: ${err?.response?.data?.message || err.message}`)
          }
        }
      }

      // Push initial stock to each variant's marketplace SKU
      if (typeof (input as any).initialStock === 'number') {
        const stock = (input as any).initialStock as number
        const variantSkus = createdVariants
          .map((v) => v?.sku)
          .filter((s) => typeof s === 'string')
        if (variantSkus.length) {
          try {
            await this.pushStockBulk(client, variantSkus.map((sku) => ({ sku, quantity: stock })))
          } catch (err: any) {
            warnings.push(`stock: ${err?.response?.data?.message || err.message}`)
          }
        }
      }

      return {
        success: true,
        externalId: productId,
        rawResponse: res.data,
        ...(warnings.length ? { warnings: warnings.join('; ') } : {}),
      }
    } catch (err: any) {
      return {
        success: false,
        error: err?.response?.data?.message || err?.response?.data || err.message,
        rawResponse: err?.response?.data,
      }
    }
  }

  // POST /v2/prices/product/{productId} — body { prices: [{ type, storePrice, value, showFrom?, showTo? }] }
  // - productId is the marketplace ID returned from POST /v2/products (e.g. "MK7BHYGPTU")
  // - storePrice is the seller-specific store UUID (kept in connection config)
  // - type is the priceType UUID from /v2/price-types
  async uploadPrices(
    client: AxiosInstance,
    productId: string,
    storeId: string,
    prices: ParisPriceInput[],
  ): Promise<void> {
    const body = {
      prices: prices.map((p) => {
        const item: Record<string, unknown> = {
          type: p.priceTypeId,
          storePrice: storeId,
          value: p.value,
        }
        if (p.startDate) item.showFrom = p.startDate
        if (p.endDate)   item.showTo   = p.endDate
        return item
      }),
    }
    await client.post(`/v2/prices/product/${encodeURIComponent(productId)}`, body)
  }

  // Public helper: upload prices to an existing product. Used by ProductsService
  // for re-pricing or syncing without re-creating the product.
  async setPrices(
    credentials: DriverCredentials,
    productId: string,
    storeId: string,
    prices: ParisPriceInput[],
    config?: DriverConfig,
  ): Promise<SyncResult> {
    try {
      const client = await this.buildClient(credentials, config)
      await this.uploadPrices(client, productId, storeId, prices)
      return { success: true, externalId: productId }
    } catch (err: any) {
      return {
        success: false,
        error: err?.response?.data?.message || err?.response?.data || err.message,
        rawResponse: err?.response?.data,
      }
    }
  }

  // POST /v2/stock — bulk update by marketplace variant SKU
  private async pushStockBulk(
    client: AxiosInstance,
    skus: Array<{ sku: string; quantity: number }>,
  ): Promise<void> {
    await client.post('/v2/stock', { skus })
  }

  async updateProduct(
    credentials: DriverCredentials,
    externalId: string,
    product: Partial<SyncProductInput>,
    config?: DriverConfig,
  ): Promise<SyncResult> {
    try {
      const client = await this.buildClient(credentials, config)
      const payload: Record<string, unknown> = { product: {} }
      const productPayload = payload.product as Record<string, unknown>
      if (product.title) productPayload.name = product.title
      // Paris requires the full product object on update — partial updates of
      // attributes mean re-sending all attributes. Keep this minimal until the
      // master schema models it; for now it covers name only.
      await client.patch(`/v2/products/${encodeURIComponent(externalId)}`, payload)
      return { success: true, externalId }
    } catch (err: any) {
      return {
        success: false,
        error: err?.response?.data?.message || err.message,
      }
    }
  }

  // ─── Stock ──────────────────────────────────────────────────────────────────

  // POST /v2/stock — body { skus: [{ sku, quantity }] }. The `sku` here is the
  // marketplace variant sku (e.g. MK7BHYGPTU-3), not the seller's product sku.
  async updateStock(
    credentials: DriverCredentials,
    externalId: string,
    stock: number,
    config?: DriverConfig,
  ): Promise<SyncResult> {
    try {
      const client = await this.buildClient(credentials, config)
      await client.post('/v2/stock', { skus: [{ sku: externalId, quantity: stock }] })
      return { success: true, externalId }
    } catch (err: any) {
      return {
        success: false,
        error: err?.response?.data?.message || err.message,
      }
    }
  }

  // ─── Orders ─────────────────────────────────────────────────────────────────

  async getOrders(
    credentials: DriverCredentials,
    config?: DriverConfig,
    since?: Date,
    offset = 0,
    limit = 50,
  ): Promise<PaginatedResult<MarketplaceOrder>> {
    const client = await this.buildClient(credentials, config)
    const params: Record<string, unknown> = { offset, limit }
    if (since) params.gteCreatedAt = since.toISOString().slice(0, 10) // YYYY-MM-DD

    const res = await client.get('/v1/orders', { params })
    const data = res.data?.data || []
    const total = res.data?.count ?? data.length

    return {
      items: data.map((o: any) => this.mapOrder(o)),
      total,
      offset,
      limit,
      hasMore: offset + limit < total,
    }
  }

  async getOrder(
    credentials: DriverCredentials,
    externalId: string,
    config?: DriverConfig,
  ): Promise<MarketplaceOrder | null> {
    try {
      const client = await this.buildClient(credentials, config)
      const res = await client.get(`/v1/orders/${encodeURIComponent(externalId)}`)
      return res.data ? this.mapOrder(res.data) : null
    } catch {
      return null
    }
  }

  // ─── Mappers ────────────────────────────────────────────────────────────────

  private mapProduct(data: any): MarketplaceProduct {
    // Paris product shape: { id, name, sellerSku, refProduct, attributes[], variants[], status, ... }
    const firstVariant = data.variants?.[0]
    const channel = data.channels?.[0]
    return {
      externalId: String(data.id || data.sellerSku),
      externalSku: data.sellerSku || data.refProduct,
      title: data.name,
      description: this.findAttribute(data.attributes, 'description'),
      price: parseFloat(channel?.price || firstVariant?.price || '0') || 0,
      stock: parseInt(firstVariant?.stock || '0', 10) || 0,
      images: this.collectImages(data),
      categoryId: data.category?.id,
      status: this.mapStatus(data.status, data.statusApproval),
      rawData: data,
    }
  }

  private findAttribute(attributes: any[], key: string): string | undefined {
    if (!Array.isArray(attributes)) return undefined
    const match = attributes.find(
      (a) => a?.name?.toLowerCase() === key.toLowerCase() || a?.id === key,
    )
    return match?.value
  }

  private collectImages(data: any): string[] {
    const fromVariants = (data.variants || [])
      .flatMap((v: any) => v?.medias || [])
      .map((m: any) => m?.url || m?.src)
      .filter(Boolean)
    return Array.from(new Set(fromVariants))
  }

  private mapStatus(status?: string, approval?: string): MarketplaceProduct['status'] {
    if (approval === 'rejected') return 'paused'
    if (approval === 'pending') return 'paused'
    if (status === 'active' || approval === 'approved') return 'active'
    if (status === 'paused') return 'paused'
    if (status === 'closed' || status === 'archived') return 'closed'
    return 'unknown'
  }

  private mapOrder(data: any): MarketplaceOrder {
    // Paris order shape includes nested customer, billingAddress and subOrders[].
    // We flatten the first sub-order's items as the order's items.
    const customer = data.customer || {}
    const billing = data.billingAddress || {}
    const subOrders = data.subOrders || []
    const firstSub = subOrders[0] || {}
    const shipments = firstSub.shipments || []
    const items = shipments.flatMap((s: any) => s.items || []).concat(firstSub.items || [])

    const buyerName =
      customer.name ||
      `${billing.firstName || ''} ${billing.lastName || ''}`.trim() ||
      'Unknown'

    const total = items.reduce((sum: number, it: any) => sum + Number(it.basePrice || it.price || 0), 0)

    return {
      externalId: String(data.id || data.originOrderNumber),
      externalOrderNumber: String(data.originOrderNumber || data.id),
      packId: undefined,
      status: this.mapOrderStatus(firstSub.status || data.status),
      buyerName,
      buyerEmail: customer.email,
      buyerPhone: billing.phone,
      buyerDocType: customer.documentType,
      buyerDocNumber: customer.documentNumber,
      billing:
        data.businessInvoice && data.businessInvoice !== 'boleta'
          ? {
              name: customer.name,
              docType: customer.documentType,
              docNumber: customer.documentNumber,
              invoiceType: 'factura',
            }
          : { invoiceType: 'boleta' },
      items: items.map((it: any) => ({
        externalId: String(it.id || it.sku),
        sku: it.sellerSku || it.sku || '',
        title: it.name || '',
        quantity: it.quantity || 1,
        unitPrice: Number(it.basePrice || it.price || 0),
        totalPrice: Number(it.basePrice || it.price || 0) * (it.quantity || 1),
      })),
      subtotal: total,
      shippingCost: 0,
      total,
      currency: 'CLP',
      shippingAddress: billing.address1
        ? {
            name: buyerName,
            address1: [billing.address1, billing.address2, billing.address3]
              .filter(Boolean)
              .join(', '),
            city: billing.city || '',
            state: billing.stateCode,
            country: billing.countryCode || 'CL',
            phone: billing.phone,
          }
        : undefined,
      createdAt: new Date(data.createdAt || data.originOrderDate || Date.now()),
      updatedAt: new Date(data.updatedAt || data.createdAt || Date.now()),
      rawData: data,
    }
  }

  private mapOrderStatus(status?: string): string {
    const map: Record<string, string> = {
      awaiting_fullfillment: 'pending',
      ready_to_ship: 'confirmed',
      shipped: 'fulfilled',
      delivered: 'completed',
      cancelled: 'cancelled',
      deleted: 'cancelled',
    }
    return map[status?.toLowerCase() || ''] || 'pending'
  }
}
