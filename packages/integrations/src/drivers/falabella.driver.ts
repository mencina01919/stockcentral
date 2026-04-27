import axios, { AxiosInstance } from 'axios'
import * as crypto from 'crypto'
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

// Base URLs per country — from official docs: https://developers.falabella.com/reference/getting-started
const BASE_URLS: Record<string, string> = {
  CL: 'https://sellercenter-api.falabella.com/',
  CO: 'https://sellercenter-api.linio.com.co/',
  MX: 'https://sellercenter-api.linio.com.mx/',
  PE: 'https://sellercenter-api.linio.com.pe/',
}

const STAGING_URLS: Record<string, string> = {
  CL: 'https://sellercenter-staging.falabella.com/',
  CO: 'https://sellercenter-staging.linio.com.co/',
  MX: 'https://sellercenter-staging.linio.com.mx/',
  PE: 'https://sellercenter-staging.linio.com.pe/',
}

/**
 * Falabella Seller Center API driver.
 *
 * Auth: HMAC-SHA256 signature over sorted key+value pairs.
 * Docs: https://developers.falabella.com/reference/signing-requests
 *
 * Credentials required:
 *   - userId:    your Seller Center email (shown in Seller Center → Mi cuenta → Integraciones)
 *   - apiKey:    your API Key (shown in same screen — NOT the secret)
 *
 * Config optional:
 *   - country:   'CL' | 'CO' | 'MX' | 'PE'  (default: 'CL')
 *   - staging:   true  (use staging environment)
 */
export class FalabellaDriver implements IMarketplaceDriver {
  readonly provider = 'falabella'

  // ─── Signature (per official docs) ──────────────────────────────────────────
  //
  // 1. Collect all query params EXCEPT Signature itself
  // 2. Sort keys alphabetically (case-sensitive)
  // 3. Concatenate as: key1value1key2value2...
  // 4. HMAC-SHA256 with apiKey as secret, hex-encode result
  //
  private buildSignature(params: Record<string, string>, apiKey: string): string {
    const concatenated = Object.keys(params)
      .sort()
      .map((k) => `${k}${params[k]}`)
      .join('')
    return crypto.createHmac('sha256', apiKey).update(concatenated).digest('hex')
  }

  private getBaseUrl(credentials: DriverCredentials, config?: DriverConfig): string {
    const country = ((config?.country as string) || credentials.country || 'CL').toUpperCase()
    const staging = config?.staging === true
    const urls = staging ? STAGING_URLS : BASE_URLS
    return urls[country] || BASE_URLS.CL
  }

  private buildClient(credentials: DriverCredentials, config?: DriverConfig): AxiosInstance {
    return axios.create({
      baseURL: this.getBaseUrl(credentials, config),
      timeout: 20000,
    })
  }

  // Builds query params with valid ISO8601 timestamp and HMAC signature
  private buildParams(
    credentials: DriverCredentials,
    action: string,
    extra: Record<string, string> = {},
  ): Record<string, string> {
    // ISO8601 with timezone offset as required by the API
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00')

    const params: Record<string, string> = {
      Action: action,
      Format: 'JSON',
      Timestamp: timestamp,
      UserID: credentials.userId,
      Version: '1.0',
      ...extra,
    }

    // Signature is computed AFTER all other params are set, then appended
    params.Signature = this.buildSignature(params, credentials.apiKey)
    return params
  }

  // ─── testConnection ──────────────────────────────────────────────────────────

  async testConnection(credentials: DriverCredentials, config?: DriverConfig): Promise<ConnectionTestResult> {
    try {
      const client = this.buildClient(credentials, config)
      const params = this.buildParams(credentials, 'GetSeller')
      const res = await client.get('', { params })

      const seller = res.data?.SuccessResponse?.Body?.Seller
      return {
        success: true,
        shopName: seller?.Name || credentials.userId,
        sellerId: credentials.userId,
      }
    } catch (err: any) {
      const msg =
        err?.response?.data?.ErrorResponse?.Head?.ErrorMessage ||
        err?.response?.data?.ErrorResponse?.Body?.ErrorMessage ||
        err.message
      return { success: false, error: msg }
    }
  }

  // ─── Products ────────────────────────────────────────────────────────────────

  async getProducts(
    credentials: DriverCredentials,
    config?: DriverConfig,
    offset = 0,
    limit = 50,
  ): Promise<PaginatedResult<MarketplaceProduct>> {
    const client = this.buildClient(credentials, config)
    const params = this.buildParams(credentials, 'GetProducts', {
      Offset: String(offset),
      Limit: String(limit),
      Filter: 'all',
    })

    const res = await client.get('', { params })
    const body = res.data?.SuccessResponse?.Body
    const rawProducts = body?.Products?.Product || []
    // API returns a single object instead of array when only 1 product
    const list = Array.isArray(rawProducts) ? rawProducts : [rawProducts]
    const products = list.map((p: any) => this.mapProduct(p))
    const total = parseInt(body?.TotalCount || String(products.length), 10)

    return { items: products, total, offset, limit, hasMore: offset + limit < total }
  }

  async getProduct(credentials: DriverCredentials, externalId: string, config?: DriverConfig): Promise<MarketplaceProduct | null> {
    try {
      const client = this.buildClient(credentials, config)
      // API accepts SkuSellerList as JSON array string
      const params = this.buildParams(credentials, 'GetProducts', {
        SkuSellerList: JSON.stringify([externalId]),
      })
      const res = await client.get('', { params })
      const raw = res.data?.SuccessResponse?.Body?.Products?.Product
      const product = Array.isArray(raw) ? raw[0] : raw
      return product ? this.mapProduct(product) : null
    } catch {
      return null
    }
  }

  // ProductCreate — sends XML body, params in query string
  // Docs: https://developers.falabella.com/reference/productcreate
  async createProduct(
    credentials: DriverCredentials,
    product: SyncProductInput,
    config?: DriverConfig,
  ): Promise<SyncResult> {
    try {
      const client = this.buildClient(credentials, config)
      const cfg = (config || {}) as Record<string, unknown>

      const today = new Date().toISOString().split('T')[0]
      const nextYear = new Date(Date.now() + 365 * 86400000).toISOString().split('T')[0]

      // Escape XML special chars
      const esc = (s: string) =>
        s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

      const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<Request>
  <Product>
    <SellerSku>${esc(product.sku)}</SellerSku>
    <Name>${esc(product.title)}</Name>
    <Description>${esc(product.description || product.title)}</Description>
    <Brand>${esc(String(cfg.brand || 'Generic'))}</Brand>
    <Price>${product.price.toFixed(2)}</Price>
    <SalePrice>${product.price.toFixed(2)}</SalePrice>
    <SaleStartDate>${today}</SaleStartDate>
    <SaleEndDate>${nextYear}</SaleEndDate>
    <Status>active</Status>
    <Quantity>${product.stock}</Quantity>
    <PrimaryCategory>${esc(String(product.categoryId || cfg.defaultCategoryId || ''))}</PrimaryCategory>
    <TaxClass>${esc(String(cfg.taxClass || 'default'))}</TaxClass>
    <ProductData>
      <ConditionType>${esc(String(cfg.conditionType || 'new'))}</ConditionType>
    </ProductData>
    <Images>
      ${(product.images || []).map((url) => `<Image>${esc(url)}</Image>`).join('\n      ')}
    </Images>
  </Product>
</Request>`

      const params = this.buildParams(credentials, 'ProductCreate')
      const res = await client.post('', xmlPayload, {
        params,
        headers: { 'Content-Type': 'text/xml; charset=UTF-8' },
      })

      // ProductCreate is async — returns a FeedID, not the product ID immediately
      const feedId = res.data?.SuccessResponse?.Body?.RequestId
      return {
        success: true,
        externalId: product.sku, // SellerSku is the stable external ID for Falabella
        rawResponse: { feedId, ...res.data },
      }
    } catch (err: any) {
      const msg =
        err?.response?.data?.ErrorResponse?.Head?.ErrorMessage ||
        err?.response?.data?.ErrorResponse?.Body?.ErrorMessage ||
        err.message
      return { success: false, error: msg }
    }
  }

  // ProductUpdate — same shape as ProductCreate but with Action=ProductUpdate
  // Docs: https://developers.falabella.com/reference/productupdate
  async updateProduct(
    credentials: DriverCredentials,
    externalId: string,
    product: Partial<SyncProductInput>,
    config?: DriverConfig,
  ): Promise<SyncResult> {
    try {
      const client = this.buildClient(credentials, config)
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

      const fields: string[] = [`<SellerSku>${esc(externalId)}</SellerSku>`]
      if (product.title) fields.push(`<Name>${esc(product.title)}</Name>`)
      if (product.description) fields.push(`<Description>${esc(product.description)}</Description>`)
      if (product.price !== undefined) {
        fields.push(`<Price>${product.price.toFixed(2)}</Price>`)
        fields.push(`<SalePrice>${product.price.toFixed(2)}</SalePrice>`)
      }

      const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?><Request><Product>${fields.join('')}</Product></Request>`
      const params = this.buildParams(credentials, 'ProductUpdate')

      const res = await client.post('', xmlPayload, {
        params,
        headers: { 'Content-Type': 'text/xml; charset=UTF-8' },
      })

      return { success: true, externalId, rawResponse: res.data }
    } catch (err: any) {
      const msg =
        err?.response?.data?.ErrorResponse?.Head?.ErrorMessage ||
        err?.response?.data?.ErrorResponse?.Body?.ErrorMessage ||
        err.message
      return { success: false, error: msg }
    }
  }

  // UpdateStock — dedicated action, different from ProductUpdate
  // Docs: https://developers.falabella.com/v500/reference/updatestock
  async updateStock(
    credentials: DriverCredentials,
    externalId: string,
    stock: number,
    config?: DriverConfig,
  ): Promise<SyncResult> {
    try {
      const client = this.buildClient(credentials, config)
      const cfg = (config || {}) as Record<string, unknown>

      const fields = [`<SellerSku>${externalId}</SellerSku>`, `<Quantity>${stock}</Quantity>`]
      if (cfg.sellerWarehouseId) {
        fields.push(`<SellerWarehouseId>${cfg.sellerWarehouseId}</SellerWarehouseId>`)
      }

      const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?><Request><Product>${fields.join('')}</Product></Request>`
      const params = this.buildParams(credentials, 'UpdateStock')

      const res = await client.post('', xmlPayload, {
        params,
        headers: { 'Content-Type': 'text/xml; charset=UTF-8' },
      })

      return { success: true, externalId, rawResponse: res.data }
    } catch (err: any) {
      const msg =
        err?.response?.data?.ErrorResponse?.Head?.ErrorMessage ||
        err?.response?.data?.ErrorResponse?.Body?.ErrorMessage ||
        err.message
      return { success: false, error: msg }
    }
  }

  // ─── Orders ──────────────────────────────────────────────────────────────────

  // GetOrders — requires CreatedAfter OR UpdatedAfter (mandatory per docs)
  // Docs: https://developers.falabella.com/reference/getorders
  async getOrders(
    credentials: DriverCredentials,
    config?: DriverConfig,
    since?: Date,
    offset = 0,
    limit = 50,
  ): Promise<PaginatedResult<MarketplaceOrder>> {
    const client = this.buildClient(credentials, config)

    // API mandates at least one date filter — default to 30 days ago if none given
    const after = since || new Date(Date.now() - 30 * 24 * 3600 * 1000)
    const createdAfter = after.toISOString().replace(/\.\d{3}Z$/, '+00:00')

    const params = this.buildParams(credentials, 'GetOrders', {
      CreatedAfter: createdAfter,
      Limit: String(limit),
      Offset: String(offset),
      SortBy: 'created_at',
      SortDirection: 'DESC',
    })

    const res = await client.get('', { params })
    const body = res.data?.SuccessResponse?.Body
    const rawOrders = body?.Orders?.Order || []
    const list = Array.isArray(rawOrders) ? rawOrders : [rawOrders]
    const orders: MarketplaceOrder[] = []

    // GetOrders returns order headers; items are fetched per order via GetOrderItems
    for (const o of list) {
      const order = await this.fetchOrderWithItems(credentials, config, o)
      orders.push(order)
    }

    const total = parseInt(body?.CountTotal || String(orders.length), 10)
    return { items: orders, total, offset, limit, hasMore: offset + limit < total }
  }

  async getOrder(credentials: DriverCredentials, externalId: string, config?: DriverConfig): Promise<MarketplaceOrder | null> {
    try {
      const client = this.buildClient(credentials, config)
      const params = this.buildParams(credentials, 'GetOrder', { OrderId: externalId })
      const res = await client.get('', { params })
      const raw = res.data?.SuccessResponse?.Body?.Orders?.Order
      const order = Array.isArray(raw) ? raw[0] : raw
      if (!order) return null
      return this.fetchOrderWithItems(credentials, config, order)
    } catch {
      return null
    }
  }

  // GetOrderItems — fetches line items for a given order
  // Docs: https://developers.falabella.com/reference/getorderitems
  private async fetchOrderWithItems(
    credentials: DriverCredentials,
    config: DriverConfig | undefined,
    orderHeader: any,
  ): Promise<MarketplaceOrder> {
    try {
      const client = this.buildClient(credentials, config)
      const params = this.buildParams(credentials, 'GetOrderItems', {
        OrderId: String(orderHeader.OrderId),
      })
      const res = await client.get('', { params })
      const rawItems = res.data?.SuccessResponse?.Body?.OrderItems?.OrderItem || []
      const items = Array.isArray(rawItems) ? rawItems : [rawItems]
      return this.mapOrder(orderHeader, items)
    } catch {
      return this.mapOrder(orderHeader, [])
    }
  }

  // ─── Mappers ─────────────────────────────────────────────────────────────────

  private mapProduct(data: any): MarketplaceProduct {
    const images = data.Images?.Image
    return {
      externalId: data.SellerSku,
      externalSku: data.SellerSku,
      title: data.Name,
      description: data.Description,
      price: parseFloat(data.Price || '0'),
      stock: parseInt(data.Quantity || '0', 10),
      images: images ? (Array.isArray(images) ? images : [images]) : [],
      status: data.Status === 'active' ? 'active' : 'paused',
      rawData: data,
    }
  }

  private mapOrder(header: any, items: any[]): MarketplaceOrder {
    const addr = header.AddressShipping
    return {
      externalId: String(header.OrderId),
      externalOrderNumber: String(header.OrderNumber || header.OrderId),
      status: header.Status,
      buyerName: header.CustomerFirstName
        ? `${header.CustomerFirstName} ${header.CustomerLastName || ''}`.trim()
        : 'Unknown',
      buyerEmail: header.CustomerEmail,
      items: items.map((item: any) => ({
        externalId: String(item.OrderItemId),
        sku: item.SellerSku || item.ShopSku,
        title: item.Name,
        quantity: parseInt(item.QtyOrdered || '1', 10),
        unitPrice: parseFloat(item.PaidPrice || item.Price || '0'),
        totalPrice: parseFloat(item.PaidPrice || '0') * parseInt(item.QtyOrdered || '1', 10),
      })),
      subtotal: parseFloat(header.Price || '0'),
      shippingCost: 0,
      total: parseFloat(header.Price || '0'),
      currency: header.CurrencyCode || 'CLP',
      shippingAddress: addr
        ? {
            name: `${addr.FirstName || ''} ${addr.LastName || ''}`.trim(),
            address1: addr.Address1,
            address2: addr.Address2 || undefined,
            city: addr.City,
            state: addr.Ward || addr.State,
            zipCode: addr.PostCode,
            country: addr.Country || 'CL',
            phone: addr.Phone,
          }
        : undefined,
      createdAt: new Date(header.CreatedAt),
      updatedAt: new Date(header.UpdatedAt || header.CreatedAt),
      rawData: header,
    }
  }
}
