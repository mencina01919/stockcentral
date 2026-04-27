import axios, { AxiosInstance } from 'axios'
import * as crypto from 'crypto'
import { XMLParser } from 'fast-xml-parser'

const xmlParser = new XMLParser({ ignoreAttributes: false, isArray: (name) => ['Product', 'Order', 'OrderItem', 'Brand', 'Image'].includes(name) })
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

  // ─── Signature ──────────────────────────────────────────────────────────────
  //
  // Real algorithm confirmed via API Explorer reverse-engineering:
  // 1. Sort all params (except Signature) alphabetically by key
  // 2. URL-encode each key and value with encodeURIComponent
  // 3. Join as key=value&key=value (standard query string)
  // 4. HMAC-SHA256 with apiKey as secret, hex output
  //
  // Note: Falabella SC does NOT validate timestamp freshness,
  // but does validate signature correctness strictly.
  //
  private buildSignature(params: Record<string, string>, apiKey: string): string {
    const qs = Object.entries(params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&')
    return crypto.createHmac('sha256', apiKey).update(qs).digest('hex')
  }

  private getBaseUrl(credentials: DriverCredentials, config?: DriverConfig): string {
    const country = ((config?.country as string) || credentials.country || 'CL').toUpperCase()
    const staging = config?.staging === true
    const urls = staging ? STAGING_URLS : BASE_URLS
    return urls[country] || BASE_URLS.CL
  }

  private buildClient(credentials: DriverCredentials, config?: DriverConfig): AxiosInstance {
    const client = axios.create({
      baseURL: this.getBaseUrl(credentials, config),
      timeout: 20000,
    })
    // Falabella SC only supports Format=XML — parse XML response into JS object
    client.interceptors.response.use((response) => {
      if (typeof response.data === 'string' && response.data.trim().startsWith('<')) {
        response.data = xmlParser.parse(response.data)
      }
      return response
    })
    return client
  }

  // Builds query params with local-offset timestamp and HMAC signature.
  // Falabella SC requires local timezone offset (e.g. -04:00 for Chile), not UTC.
  private buildParams(
    credentials: DriverCredentials,
    action: string,
    extra: Record<string, string> = {},
  ): Record<string, string> {
    // Use local time with offset instead of UTC — server validates format strictly
    const now = new Date()
    const offsetMin = -now.getTimezoneOffset()
    const sign = offsetMin >= 0 ? '+' : '-'
    const absMin = Math.abs(offsetMin)
    const hh = String(Math.floor(absMin / 60)).padStart(2, '0')
    const mm = String(absMin % 60).padStart(2, '0')
    const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString()
      .replace(/\.\d{3}Z$/, '')
    const timestamp = `${localIso}${sign}${hh}:${mm}`

    // Falabella Chile SC only accepts Format=XML — JSON returns signature mismatch
    const params: Record<string, string> = {
      Action: action,
      Format: 'XML',
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
      // GetSeller is not available in Falabella CL — use GetBrands as connectivity probe
      const params = this.buildParams(credentials, 'GetBrands')
      const res = await client.get('', { params })

      if (res.data?.ErrorResponse) {
        const msg =
          res.data.ErrorResponse?.Head?.ErrorMessage ||
          res.data.ErrorResponse?.Body?.ErrorMessage ||
          'Error desconocido'
        return { success: false, error: msg }
      }

      return {
        success: true,
        shopName: credentials.userId,
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
    // Price and stock live inside BusinessUnits.BusinessUnit (single BU or array)
    const bu = data.BusinessUnits?.BusinessUnit
    const firstBu = Array.isArray(bu) ? bu[0] : bu
    const price = parseFloat(firstBu?.SpecialPrice || firstBu?.Price || data.Price || '0')
    const stock = parseInt(firstBu?.Stock || data.Quantity || '0', 10)
    const status = firstBu?.Status === 'active' ? 'active' : 'paused'
    return {
      externalId: data.SellerSku,
      externalSku: data.SellerSku,
      title: data.Name,
      description: data.Description,
      price,
      stock,
      images: images ? (Array.isArray(images) ? images : [images]) : [],
      status,
      rawData: data,
    }
  }

  private mapOrder(header: any, items: any[]): MarketplaceOrder {
    const addr = header.AddressShipping
    // Status lives in Statuses.Status (string or array)
    const statusRaw = header.Statuses?.Status
    const status = Array.isArray(statusRaw) ? statusRaw[0] : (statusRaw || header.Status || 'pending')

    const mappedItems = items.map((item: any) => ({
      externalId: String(item.OrderItemId),
      sku: item.Sku || item.SellerSku || item.ShopSku,
      title: item.Name,
      quantity: 1, // Falabella SC: each OrderItem = 1 unit (separate items for qty > 1)
      unitPrice: parseFloat(item.PaidPrice || item.ItemPrice || '0'),
      totalPrice: parseFloat(item.PaidPrice || item.ItemPrice || '0'),
    }))

    const currency = items[0]?.Currency || 'CLP'
    const subtotal = parseFloat(header.ProductTotal?.replace(/,/g, '') || header.Price || '0')
    const shipping = parseFloat(header.ShippingFeeTotal?.replace(/,/g, '') || '0')
    const total = parseFloat(header.GrandTotal?.replace(/,/g, '') || header.Price || '0')

    return {
      externalId: String(header.OrderId),
      externalOrderNumber: String(header.OrderNumber || header.OrderId),
      status,
      buyerName: header.CustomerFirstName
        ? `${header.CustomerFirstName} ${header.CustomerLastName || ''}`.trim()
        : (addr?.FirstName || 'Unknown'),
      buyerEmail: header.AddressBilling?.CustomerEmail || header.CustomerEmail,
      items: mappedItems,
      subtotal,
      shippingCost: shipping,
      total,
      currency,
      shippingAddress: addr
        ? {
            name: `${addr.FirstName || ''} ${addr.LastName || ''}`.trim(),
            address1: [addr.Address1, addr.Address2, addr.Address3].filter(Boolean).join(', '),
            city: addr.City,
            state: addr.Ward || addr.Region,
            zipCode: addr.PostCode || undefined,
            country: addr.Country || 'CL',
            phone: addr.Phone || undefined,
          }
        : undefined,
      createdAt: new Date(header.CreatedAt),
      updatedAt: new Date(header.UpdatedAt || header.CreatedAt),
      rawData: header,
    }
  }
}
