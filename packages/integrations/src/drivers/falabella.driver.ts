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

    // Format defaults to XML (default content-type for write actions). For JSON
    // metadata reads, callers can override via extra.Format = 'JSON'.
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

  async findBySku(credentials: DriverCredentials, sku: string, config?: DriverConfig): Promise<MarketplaceProduct[]> {
    if (!sku) return []
    const product = await this.getProduct(credentials, sku, config)
    // Falabella SellerSku is the unique key — at most 1 match.
    return product ? [product] : []
  }

  // ProductCreate — sends XML body, params in query string
  // Docs: https://developers.falabella.com/reference/productcreate
  //
  // Top-level XML fields (per Falabella spec): SellerSku, Name, Description, Brand,
  // PrimaryCategory, ProductId, ProductIdType, TaxClass, Variation, ParentSku,
  // Quantity, Price, SalePrice, SaleStartDate, SaleEndDate, Status, BusinessUnits,
  // Images, ProductData (container for category-specific attrs).
  //
  // Anything sent in formData using the attribute's FeedName (returned by
  // GetCategoryAttributes) goes into ProductData. Top-level fields are taken from
  // the SyncProductInput and a small whitelist below.
  async createProduct(
    credentials: DriverCredentials,
    product: SyncProductInput,
    config?: DriverConfig,
  ): Promise<SyncResult> {
    try {
      const client = this.buildClient(credentials, config)
      const cfg = (config || {}) as Record<string, unknown>
      const fd = ((product as any).formData ?? {}) as Record<string, any>

      const esc = (s: string) =>
        String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

      // Top-level fields at <Product> level (NOT in ProductData, NOT in BusinessUnits)
      const TOP_LEVEL = new Set([
        'SellerSku', 'Name', 'Description', 'Brand', 'PrimaryCategory',
        'ProductId', 'ProductIdType', 'TaxClass', 'Variation', 'ParentSku', 'Status',
      ])
      // Fields that belong inside <BusinessUnits><BusinessUnit>...</BusinessUnit></BusinessUnits>
      const BU_LEVEL = new Set(['Price', 'SalePrice', 'SaleStartDate', 'SaleEndDate', 'Stock', 'Quantity', 'IsPublished'])

      const today = new Date().toISOString().split('T')[0]
      const nextYear = new Date(Date.now() + 365 * 86400000).toISOString().split('T')[0]

      // Build top-level fields with explicit precedence: formData > product/cfg defaults
      const topLevel: Record<string, string> = {
        SellerSku:       String(product.sku),
        Name:            String(fd.Name || product.title),
        Description:     String(fd.Description || product.description || product.title),
        Brand:           String(fd.Brand || cfg.brand || ''),
        PrimaryCategory: String(fd.PrimaryCategory || product.categoryId || cfg.defaultCategoryId || ''),
        Status:          String(fd.Status || 'active'),
        TaxClass:        String(fd.TaxClass || cfg.taxClass || 'IVA 19%'),
        Variation:       String(fd.Variation || 'NO'),
      }
      if (fd.ProductId)     topLevel.ProductId = String(fd.ProductId)
      if (fd.ProductIdType) topLevel.ProductIdType = String(fd.ProductIdType)
      if (fd.ParentSku)     topLevel.ParentSku = String(fd.ParentSku)

      // Build BusinessUnits — defaults to a single BU with the seller's account.
      // OperatorCode 'facl' = Falabella Chile. For multi-BU sellers (Tottus,
      // Sodimac, Linio), pass formData.BusinessUnits as an array of BU objects.
      const businessUnits = Array.isArray(fd.BusinessUnits) && fd.BusinessUnits.length
        ? fd.BusinessUnits
        : [{
            OperatorCode: String(fd.OperatorCode || cfg.operatorCode || 'facl'),
            Price:        Number(fd.Price ?? product.price).toFixed(2),
            Stock:        String(fd.Stock ?? fd.Quantity ?? product.stock ?? 0),
            Status:       String(fd.Status || 'active'),
            IsPublished:  String(fd.IsPublished ?? '1'),
            ...(fd.SalePrice ? { SalePrice: Number(fd.SalePrice).toFixed(2) } : {}),
            ...(fd.SaleStartDate ? { SaleStartDate: String(fd.SaleStartDate) } : {}),
            ...(fd.SaleEndDate ? { SaleEndDate: String(fd.SaleEndDate) } : {}),
          }]

      const businessUnitsXml = '<BusinessUnits>\n      ' +
        businessUnits.map((bu: Record<string, any>) =>
          `<BusinessUnit>\n        ${
            Object.entries(bu)
              .filter(([, v]) => v !== undefined && v !== null && v !== '')
              .map(([k, v]) => `<${k}>${esc(String(v))}</${k}>`)
              .join('\n        ')
          }\n      </BusinessUnit>`
        ).join('\n      ') +
        '\n    </BusinessUnits>'

      // Everything else from formData goes into <ProductData> using its FeedName key
      const productDataFields: string[] = []
      for (const [k, v] of Object.entries(fd)) {
        if (TOP_LEVEL.has(k) || BU_LEVEL.has(k)) continue
        if (k === 'BusinessUnits' || k === 'OperatorCode') continue
        if (v === undefined || v === null || v === '') continue
        if (Array.isArray(v)) {
          productDataFields.push(`<${k}>${esc(v.join(','))}</${k}>`)
        } else {
          productDataFields.push(`<${k}>${esc(String(v))}</${k}>`)
        }
      }

      const topLevelXml = Object.entries(topLevel)
        .map(([k, v]) => `<${k}>${esc(v)}</${k}>`)
        .join('\n    ')

      const imagesXml = (product.images || [])
        .map((url) => `<Image>${esc(url)}</Image>`)
        .join('\n      ')

      const productDataXml = productDataFields.length
        ? `<ProductData>\n      ${productDataFields.join('\n      ')}\n    </ProductData>`
        : '<ProductData></ProductData>'

      const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<Request>
  <Product>
    ${topLevelXml}
    ${businessUnitsXml}
    ${productDataXml}
    <Images>
      ${imagesXml}
    </Images>
  </Product>
</Request>`

      const params = this.buildParams(credentials, 'ProductCreate')
      const res = await client.post('', xmlPayload, {
        params,
        headers: { 'Content-Type': 'text/xml; charset=UTF-8' },
      })

      if (res.data?.ErrorResponse) {
        const head = res.data.ErrorResponse?.Head
        const body = res.data.ErrorResponse?.Body
        // Body.Errors.Error[] holds detailed cause list when present
        const detailErrors = body?.Errors?.Error
        const detailList = Array.isArray(detailErrors) ? detailErrors : (detailErrors ? [detailErrors] : [])
        const detailMsg = detailList.map((e: any) => e?.Message || e?.message || JSON.stringify(e)).join(' | ')
        return {
          success: false,
          error: detailMsg || head?.ErrorMessage || 'ProductCreate error',
          rawResponse: res.data,
        }
      }

      const feedId = res.data?.SuccessResponse?.Head?.RequestId ||
                     res.data?.SuccessResponse?.Body?.RequestId ||
                     res.data?.SuccessResponse?.Body?.FeedId
      return {
        success: true,
        externalId: product.sku, // SellerSku is the stable external ID for Falabella
        rawResponse: { feedId, ...res.data },
      }
    } catch (err: any) {
      const data = err?.response?.data
      const detailErrors = data?.ErrorResponse?.Body?.Errors?.Error
      const detailList = Array.isArray(detailErrors) ? detailErrors : (detailErrors ? [detailErrors] : [])
      const detailMsg = detailList.map((e: any) => e?.Message || e?.message || JSON.stringify(e)).join(' | ')
      const msg = detailMsg ||
        data?.ErrorResponse?.Head?.ErrorMessage ||
        data?.ErrorResponse?.Body?.ErrorMessage ||
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

  // Image — associates hosted image URLs with a product SKU
  // Docs: https://developers.falabella.com/v500/reference/image
  // Images must be publicly accessible URLs; Falabella fetches them server-side.
  // The first image listed becomes the product's default image.
  async updateImages(
    credentials: DriverCredentials,
    externalId: string,
    imageUrls: string[],
    config?: DriverConfig,
  ): Promise<SyncResult> {
    try {
      const client = this.buildClient(credentials, config)
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

      const imageXml = imageUrls
        .slice(0, 8) // Falabella accepts up to 8 images per product
        .map((url, i) => `<Image${i + 1}>${esc(url)}</Image${i + 1}>`)
        .join('')

      const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?><Request><Product><SellerSku>${esc(externalId)}</SellerSku>${imageXml}</Product></Request>`
      const params = this.buildParams(credentials, 'Image')

      const res = await client.post('', xmlPayload, {
        params,
        headers: { 'Content-Type': 'text/xml; charset=UTF-8' },
      })

      if (res.data?.ErrorResponse) {
        const msg = res.data.ErrorResponse?.Head?.ErrorMessage || res.data.ErrorResponse?.Body?.ErrorMessage || 'Error desconocido'
        return { success: false, error: msg }
      }

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

  // ─── Metadata (categories / attributes / brands) ────────────────────────────

  // Internal helper: makes a JSON-formatted GET request, returns raw response body.
  private async callJson(
    credentials: DriverCredentials,
    config: DriverConfig | undefined,
    action: string,
    extra: Record<string, string> = {},
  ): Promise<any> {
    // Use a JSON-only client (no XML interceptor) for metadata reads
    const baseUrl = this.getBaseUrl(credentials, config)
    const params = this.buildParams(credentials, action, { ...extra, Format: 'JSON' })
    const res = await axios.get(baseUrl, { params, timeout: 20000 })
    if (res.data?.ErrorResponse) {
      const head = res.data.ErrorResponse?.Head
      throw new Error(head?.ErrorMessage || 'Falabella API error')
    }
    return res.data?.SuccessResponse?.Body
  }

  // GetCategoryTree — full category tree. Cache externally; rarely changes.
  // Docs: https://developers.falabella.com/reference/getcategorytree
  async getCategoryTree(credentials: DriverCredentials, config?: DriverConfig): Promise<any> {
    const body = await this.callJson(credentials, config, 'GetCategoryTree')
    return body?.Categories?.Category || []
  }

  // GetCategoryAttributes — list attributes for a leaf category.
  // Docs: https://developers.falabella.com/reference/getcategoryattributes
  async getCategoryAttributes(
    credentials: DriverCredentials,
    categoryId: string,
    config?: DriverConfig,
  ): Promise<any[]> {
    const body = await this.callJson(credentials, config, 'GetCategoryAttributes', {
      PrimaryCategory: categoryId,
    })
    const raw = body?.Attribute
    if (!raw) return []
    return Array.isArray(raw) ? raw : [raw]
  }

  // GetBrands — paginated. Falabella has thousands of brands; caller paginates.
  // Docs: https://developers.falabella.com/reference/getbrands
  async getBrands(
    credentials: DriverCredentials,
    config?: DriverConfig,
    offset = 0,
    limit = 100,
  ): Promise<{ items: any[]; total: number; offset: number; limit: number }> {
    const body = await this.callJson(credentials, config, 'GetBrands', {
      Offset: String(offset),
      Limit: String(limit),
    })
    const raw = body?.Brands?.Brand
    const items = !raw ? [] : (Array.isArray(raw) ? raw : [raw])
    const total = parseInt(body?.TotalCount || String(items.length), 10)
    return { items, total, offset, limit }
  }

  // GetQcStatus — quality-check status for already-created products.
  // Falabella has no pre-publish validate; closest signal is QC after ProductCreate.
  // Docs: https://developers.falabella.com/reference/getqcstatus
  async getQcStatus(
    credentials: DriverCredentials,
    skus: string[],
    config?: DriverConfig,
  ): Promise<any[]> {
    const body = await this.callJson(credentials, config, 'GetQcStatus', {
      SkuSellerList: JSON.stringify(skus),
    })
    const raw = body?.Status?.Status || body?.Status
    if (!raw || raw === '') return []
    return Array.isArray(raw) ? raw : [raw]
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
      externalId: String(data.SellerSku),
      externalSku: String(data.SellerSku),
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
    const billAddr = header.AddressBilling
    // Status lives in Statuses.Status (string or array)
    const statusRaw = header.Statuses?.Status
    const status = Array.isArray(statusRaw) ? statusRaw[0] : (statusRaw || header.Status || 'pending')

    const mappedItems = items.map((item: any) => ({
      externalId: String(item.OrderItemId),
      sku: String(item.Sku || item.SellerSku || item.ShopSku || ''),
      title: item.Name,
      quantity: 1, // Falabella SC: each OrderItem = 1 unit (separate items for qty > 1)
      unitPrice: parseFloat(item.PaidPrice || item.ItemPrice || '0'),
      totalPrice: parseFloat(item.PaidPrice || item.ItemPrice || '0'),
    }))

    const currency = items[0]?.Currency || 'CLP'
    const toNum = (v: unknown) => parseFloat(String(v ?? '0').replace(/,/g, ''))
    const subtotal = toNum(header.ProductTotal ?? header.Price)
    const shipping = toNum(header.ShippingFeeTotal)
    const total = toNum(header.GrandTotal ?? header.Price)

    const buyerEmail = header.AddressBilling?.CustomerEmail || header.CustomerEmail
    const buyerPhone = addr?.Phone || billAddr?.Phone
    const buyerName = header.CustomerFirstName
      ? `${header.CustomerFirstName} ${header.CustomerLastName || ''}`.trim()
      : (addr?.FirstName ? `${addr.FirstName} ${addr.LastName || ''}`.trim() : 'Unknown')

    const billingName = billAddr
      ? `${billAddr.FirstName || ''} ${billAddr.LastName || ''}`.trim()
      : undefined

    return {
      externalId: String(header.OrderId),
      externalOrderNumber: String(header.OrderNumber || header.OrderId),
      status,
      buyerName,
      buyerEmail,
      buyerPhone,
      billing: billAddr
        ? {
            name: billingName,
            email: billAddr.CustomerEmail || buyerEmail,
            phone: billAddr.Phone || billAddr.Phone2,
          }
        : undefined,
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
      billingAddress: billAddr
        ? {
            name: billingName || '',
            address1: [billAddr.Address1, billAddr.Address2, billAddr.Address3].filter(Boolean).join(', '),
            city: billAddr.City,
            state: billAddr.Ward || billAddr.Region,
            zipCode: billAddr.PostCode || undefined,
            country: billAddr.Country || 'CL',
            phone: billAddr.Phone || undefined,
          }
        : undefined,
      createdAt: new Date(header.CreatedAt),
      updatedAt: new Date(header.UpdatedAt || header.CreatedAt),
      rawData: header,
    }
  }
}
