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
    const res = await client.get('/v2/products/search', { params: { limit, offset } })
    const results = res.data?.results || []
    const total = res.data?.total ?? results.length
    return {
      items: results.map((p: any) => this.mapProduct(p)),
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

  async createProduct(
    _credentials: DriverCredentials,
    _product: SyncProductInput,
    _config?: DriverConfig,
  ): Promise<SyncResult> {
    // Paris requires homologation: family + category + family-specific attributes
    // must be resolved before POST /v2/products. Implement once the master
    // product schema captures Paris-specific fields (familyId, categoryId, attributes).
    return {
      success: false,
      error:
        'Crear productos en Paris requiere familia, categoría y atributos homologados. Pendiente: configurar campos Paris en metadata del producto maestro.',
    }
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

  // POST /v1/stock — body { sellerSku, stock } per docs (Stock area uses a separate API).
  // Endpoint accepts a per-SKU update by seller SKU.
  async updateStock(
    credentials: DriverCredentials,
    externalId: string,
    stock: number,
    config?: DriverConfig,
  ): Promise<SyncResult> {
    try {
      const client = await this.buildClient(credentials, config)
      await client.post('/v1/stock', { sellerSku: externalId, stock })
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
