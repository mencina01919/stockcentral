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

  // Build Orderable + Visible MPItem payload from formData (fields come from LiderSpecService / Item Spec 4.3)
  private buildMPItemPayload(product: Partial<SyncProductInput> & { formData?: Record<string, any> }): Record<string, any> {
    const fd: Record<string, any> = (product as any).formData ?? (product as any)
    const [mainImage, ...additionalImages] = product.images ?? []

    // ── Orderable (required by Walmart, spec-exact names) ──────────────────
    const orderable: Record<string, any> = {
      sku: fd.sku || product.sku,
      productName: fd.productName || product.title,
      brand: fd.brand,
      price: { currentPrice: { value: String(fd.price ?? product.price), currency: 'CLP' } },
      ShippingWeight: {
        measure: String(fd.shippingWeightValue || 1),
        unit: fd.shippingWeightUnit || 'KG',
      },
      productIdentifiers: {
        productIdentifier: [{
          productIdType: fd.productIdType || 'UPC',
          productId: fd.productId || product.sku,
        }],
      },
    }
    if (fd.fulfillmentLagTime)  orderable.fulfillmentLagTime  = fd.fulfillmentLagTime
    if (fd.multipackQuantity)   orderable.multipackQuantity   = String(fd.multipackQuantity)
    if (fd.startDate)           orderable.startDate           = fd.startDate
    if (fd.endDate)             orderable.endDate             = fd.endDate
    if (fd.electronicsIndicator) orderable.electronicsIndicator = fd.electronicsIndicator
    if (fd.batteryTechnologyType) orderable.batteryTechnologyType = fd.batteryTechnologyType
    if (fd.chemicalAerosolPesticide) orderable.chemicalAerosolPesticide = fd.chemicalAerosolPesticide

    // ── Visible (spec-exact field names for the productType) ───────────────
    // All remaining formData keys that are NOT orderable fields go into Visible.
    // The LiderSpecService already sets field keys matching the spec exactly.
    const ORDERABLE_KEYS = new Set([
      'sku', 'productName', 'brand', 'price', 'shippingWeightValue', 'shippingWeightUnit',
      'productIdType', 'productId', 'fulfillmentLagTime', 'multipackQuantity',
      'startDate', 'endDate', 'electronicsIndicator', 'batteryTechnologyType',
      'chemicalAerosolPesticide', 'images', 'availableQuantity',
    ])

    const visible: Record<string, any> = {
      productType: fd.productType,
      shortDescription: (fd.shortDescription || product.description || product.title || '').slice(0, 4000),
    }
    if (mainImage) visible.mainImageUrl = mainImage
    if (additionalImages.length) visible.productSecondaryImageURL = additionalImages.slice(0, 9)

    // Copy all spec-exact visible fields from formData
    for (const [key, val] of Object.entries(fd)) {
      if (ORDERABLE_KEYS.has(key)) continue
      if (key === 'shortDescription') continue // already set
      if (val === undefined || val === null || val === '') continue

      // measure fields come as key_value + key_unit pairs → reassemble
      if (key.endsWith('_value')) {
        const base = key.slice(0, -6)
        const unit = fd[`${base}_unit`]
        if (unit !== undefined) {
          visible[base] = { measure: String(val), unit }
        } else {
          visible[base] = { measure: String(val), unit: 'CM' }
        }
        continue
      }
      if (key.endsWith('_unit')) continue // consumed above

      visible[key] = val
    }

    return { orderable, visible }
  }

  async createProduct(
    credentials: DriverCredentials,
    product: SyncProductInput,
    config?: DriverConfig,
  ): Promise<SyncResult> {
    try {
      const client = await this.buildClient(credentials, config)
      const { orderable, visible } = this.buildMPItemPayload(product)

      const feedPayload = {
        MPItemFeedHeader: {
          requestId: randomUUID(),
          requestBatchSize: '1',
          feedDate: new Date().toISOString(),
          mart: 'WALMART_CL',
          locale: 'es',
        },
        MPItem: [{
          processMode: 'CREATE',
          sku: orderable.sku,
          productIdentifiers: orderable.productIdentifiers,
          MPItemAndLocationGroups: {
            MPItemGroupHeader: { isPrimaryItem: '1', isPrimaryVariant: '1' },
            Orderable: orderable,
            Visible: visible,
          },
        }],
      }

      const res = await client.post('/v3/feeds?feedType=MP_ITEM_INTL', feedPayload)

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

  async updateProduct(
    credentials: DriverCredentials,
    externalId: string,
    product: Partial<SyncProductInput>,
    config?: DriverConfig,
  ): Promise<SyncResult> {
    try {
      const client = await this.buildClient(credentials, config)
      const { orderable, visible } = this.buildMPItemPayload({ ...product, sku: externalId } as any)

      const feedPayload = {
        MPItemFeedHeader: {
          requestId: randomUUID(),
          requestBatchSize: '1',
          feedDate: new Date().toISOString(),
          mart: 'WALMART_CL',
          locale: 'es',
        },
        MPItem: [{
          processMode: 'REPLACE',
          sku: externalId,
          MPItemAndLocationGroups: {
            Orderable: orderable,
            Visible: visible,
          },
        }],
      }

      const res = await client.post('/v3/feeds?feedType=MP_ITEM_INTL', feedPayload)
      return { success: true, externalId, rawResponse: res.data }
    } catch (err: any) {
      return {
        success: false,
        error: err?.response?.data?.errors?.[0]?.description || err?.response?.data?.message || err.message,
        rawResponse: err?.response?.data,
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
      await client.put(`/v3/inventory?sku=${encodeURIComponent(externalId)}`, payload)
      return { success: true, externalId }
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
