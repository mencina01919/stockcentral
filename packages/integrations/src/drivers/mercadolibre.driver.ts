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
  OAuthTokens,
  PaginatedResult,
} from '../types'

const ML_API = 'https://api.mercadolibre.com'
const ML_AUTH = 'https://auth.mercadolibre.com'

// Site IDs: MLA=Argentina, MLB=Brasil, MLC=Chile, MLM=Mexico, MLU=Uruguay, MLC=Colombia
const SITE_BY_COUNTRY: Record<string, string> = {
  AR: 'MLA',
  BR: 'MLB',
  CL: 'MLC',
  MX: 'MLM',
  UY: 'MLU',
  CO: 'MCO',
  PE: 'MPE',
  VE: 'MLV',
}

export class MercadoLibreDriver implements IMarketplaceDriver {
  readonly provider = 'mercadolibre'

  private buildClient(accessToken: string): AxiosInstance {
    return axios.create({
      baseURL: ML_API,
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 15000,
    })
  }

  getAuthUrl(config: DriverConfig): string {
    const { clientId, redirectUri, siteId = 'MLC' } = config as Record<string, string>
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
    })
    return `${ML_AUTH}/authorization?${params.toString()}`
  }

  async exchangeCode(code: string, config: DriverConfig): Promise<OAuthTokens> {
    const { clientId, clientSecret, redirectUri } = config as Record<string, string>
    const res = await axios.post(`${ML_API}/oauth/token`, {
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    })
    return {
      accessToken: res.data.access_token,
      refreshToken: res.data.refresh_token,
      expiresAt: new Date(Date.now() + res.data.expires_in * 1000),
      sellerId: String(res.data.user_id),
    }
  }

  async refreshToken(refreshToken: string, config: DriverConfig): Promise<OAuthTokens> {
    const { clientId, clientSecret } = config as Record<string, string>
    const res = await axios.post(`${ML_API}/oauth/token`, {
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    })
    return {
      accessToken: res.data.access_token,
      refreshToken: res.data.refresh_token,
      expiresAt: new Date(Date.now() + res.data.expires_in * 1000),
      sellerId: String(res.data.user_id),
    }
  }

  async testConnection(credentials: DriverCredentials): Promise<ConnectionTestResult> {
    try {
      const client = this.buildClient(credentials.accessToken)
      const res = await client.get('/users/me')
      return {
        success: true,
        shopName: res.data.nickname,
        sellerId: String(res.data.id),
      }
    } catch (err: any) {
      return { success: false, error: err?.response?.data?.message || err.message }
    }
  }

  async getProducts(
    credentials: DriverCredentials,
    config?: DriverConfig,
    offset = 0,
    limit = 50,
  ): Promise<PaginatedResult<MarketplaceProduct>> {
    const client = this.buildClient(credentials.accessToken)
    const sellerId = credentials.sellerId

    // Get listing IDs
    const searchRes = await client.get(`/users/${sellerId}/items/search`, {
      params: { offset, limit },
    })
    const ids: string[] = searchRes.data.results
    const total: number = searchRes.data.paging.total

    if (!ids.length) {
      return { items: [], total, offset, limit, hasMore: offset + limit < total }
    }

    // Batch fetch item details (max 20 per call)
    const items: MarketplaceProduct[] = []
    const chunks = this.chunkArray(ids, 20)
    for (const chunk of chunks) {
      const detailRes = await client.get('/items', { params: { ids: chunk.join(',') } })
      for (const entry of detailRes.data) {
        if (entry.code === 200) {
          items.push(this.mapProduct(entry.body))
        }
      }
    }

    return { items, total, offset, limit, hasMore: offset + limit < total }
  }

  async findBySku(credentials: DriverCredentials, sku: string): Promise<MarketplaceProduct[]> {
    if (!sku) return []
    const client = this.buildClient(credentials.accessToken)
    const sellerId = credentials.sellerId
    const searchRes = await client.get(`/users/${sellerId}/items/search`, {
      params: { seller_custom_field: sku, limit: 50 },
    })
    const ids: string[] = searchRes.data.results || []
    if (!ids.length) return []
    const detailRes = await client.get('/items', { params: { ids: ids.join(',') } })
    const items: MarketplaceProduct[] = []
    for (const entry of detailRes.data) {
      if (entry.code === 200 && entry.body?.seller_custom_field === sku) {
        items.push(this.mapProduct(entry.body))
      }
    }
    return items
  }

  async getProduct(credentials: DriverCredentials, externalId: string): Promise<MarketplaceProduct | null> {
    try {
      const client = this.buildClient(credentials.accessToken)
      const res = await client.get(`/items/${externalId}`)
      return this.mapProduct(res.data)
    } catch {
      return null
    }
  }

  async createProduct(
    credentials: DriverCredentials,
    product: SyncProductInput,
    config?: DriverConfig,
  ): Promise<SyncResult> {
    try {
      const client = this.buildClient(credentials.accessToken)
      const cfg = (config || {}) as Record<string, unknown>
      const siteId = cfg.siteId as string || 'MLC'

      const payload: Record<string, unknown> = {
        title: product.title,
        category_id: product.categoryId || cfg.defaultCategoryId,
        price: product.price,
        currency_id: cfg.currency as string || 'CLP',
        available_quantity: product.stock,
        buying_mode: 'buy_it_now',
        listing_type_id: cfg.listingType as string || 'gold_special',
        condition: cfg.condition as string || 'new',
        description: { plain_text: product.description || product.title },
        pictures: product.images?.map((url) => ({ source: url })) || [],
      }

      const res = await client.post('/items', payload)
      return { success: true, externalId: res.data.id, rawResponse: res.data }
    } catch (err: any) {
      return { success: false, error: err?.response?.data?.message || err.message }
    }
  }

  async updateProduct(
    credentials: DriverCredentials,
    externalId: string,
    product: Partial<SyncProductInput>,
    config?: DriverConfig,
  ): Promise<SyncResult> {
    try {
      const client = this.buildClient(credentials.accessToken)
      const payload: Record<string, unknown> = {}
      if (product.title) payload.title = product.title
      if (product.price !== undefined) payload.price = product.price
      if (product.stock !== undefined) payload.available_quantity = product.stock

      await client.put(`/items/${externalId}`, payload)
      return { success: true, externalId }
    } catch (err: any) {
      return { success: false, error: err?.response?.data?.message || err.message }
    }
  }

  async updateStock(
    credentials: DriverCredentials,
    externalId: string,
    stock: number,
  ): Promise<SyncResult> {
    return this.updateProduct(credentials, externalId, { stock })
  }

  async getOrders(
    credentials: DriverCredentials,
    config?: DriverConfig,
    since?: Date,
    offset = 0,
    limit = 50,
  ): Promise<PaginatedResult<MarketplaceOrder>> {
    const client = this.buildClient(credentials.accessToken)
    const sellerId = credentials.sellerId

    const params: Record<string, unknown> = { seller: sellerId, offset, limit }
    if (since) params['date_created.from'] = since.toISOString()

    const res = await client.get('/orders/search', { params })
    const orders: MarketplaceOrder[] = []
    for (const o of res.data.results) {
      const detailed = await this.fetchOrderDetail(client, o)
      orders.push(this.mapOrder(detailed))
    }
    const total = res.data.paging.total

    return { items: orders, total, offset, limit, hasMore: offset + limit < total }
  }

  async getOrder(credentials: DriverCredentials, externalId: string): Promise<MarketplaceOrder | null> {
    try {
      const client = this.buildClient(credentials.accessToken)
      const res = await client.get(`/orders/${externalId}`)
      const detailed = await this.fetchOrderDetail(client, res.data)
      return this.mapOrder(detailed)
    } catch {
      return null
    }
  }

  // Hydrates an order with shipment receiver + billing_info — both endpoints
  // require separate calls. ML privacy rules omit them from /orders/search.
  private async fetchOrderDetail(client: any, order: any): Promise<any> {
    const shippingId = order.shipping?.id
    const [shipmentData, billingData] = await Promise.all([
      shippingId
        ? client.get(`/shipments/${shippingId}`).then((r: any) => r.data).catch(() => null)
        : Promise.resolve(null),
      client.get(`/orders/${order.id}/billing_info`).then((r: any) => r.data).catch(() => null),
    ])
    return { ...order, _shipment: shipmentData, _billingInfo: billingData }
  }

  async confirmOrder(credentials: DriverCredentials, externalId: string): Promise<SyncResult> {
    try {
      const client = this.buildClient(credentials.accessToken)
      // ML handles confirmation via shipment feedback
      const res = await client.post(`/orders/${externalId}/feedback`, { fulfilled: true })
      return { success: true, externalId }
    } catch (err: any) {
      return { success: false, error: err?.response?.data?.message || err.message }
    }
  }

  private mapProduct(data: any): MarketplaceProduct {
    return {
      externalId: data.id,
      externalSku: data.seller_custom_field,
      title: data.title,
      description: data.description?.plain_text,
      price: data.price,
      stock: data.available_quantity,
      images: data.pictures?.map((p: any) => p.url) || [],
      categoryId: data.category_id,
      status: this.mapStatus(data.status),
      url: data.permalink,
      rawData: data,
    }
  }

  private mapOrder(data: any): MarketplaceOrder {
    const buyer = data.buyer || {}
    const ident = buyer.identification || {}
    const shipment = data._shipment || {}
    const receiver = shipment.receiver_address || data.shipping?.receiver_address || {}
    // billing_info endpoint returns { billing_info: { doc_number, doc_type, additional_info: [{type,value}] } }
    const bInfo = data._billingInfo?.billing_info || data._billingInfo || {}
    const additional: Record<string, string> = {}
    for (const kv of bInfo.additional_info || []) {
      if (kv?.type) additional[kv.type] = kv.value
    }

    const billingDocType = bInfo.doc_type || additional.DOC_TYPE
    const billingDocNumber = bInfo.doc_number || additional.DOC_NUMBER
    const billingName =
      additional.BUSINESS_NAME ||
      additional.LEGAL_NAME ||
      (additional.FIRST_NAME
        ? `${additional.FIRST_NAME} ${additional.LAST_NAME || ''}`.trim()
        : undefined)
    const billingAddressLine =
      additional.STREET_NAME
        ? `${additional.STREET_NAME} ${additional.STREET_NUMBER || ''}`.trim()
        : undefined

    const buyerNameFromOrder =
      buyer.first_name || buyer.last_name
        ? `${buyer.first_name || ''} ${buyer.last_name || ''}`.trim()
        : ''
    const buyerNameFromShipment =
      receiver.receiver_name ||
      (receiver.first_name
        ? `${receiver.first_name} ${receiver.last_name || ''}`.trim()
        : '')
    const buyerName = buyerNameFromOrder || buyerNameFromShipment || 'Unknown'

    const buyerPhone =
      receiver.receiver_phone ||
      (buyer.phone?.number
        ? `${buyer.phone.area_code || ''}${buyer.phone.number}`.trim()
        : undefined)

    return {
      externalId: String(data.id),
      externalOrderNumber: String(data.id),
      packId: data.pack_id ? String(data.pack_id) : undefined,
      status: data.status,
      buyerName,
      buyerEmail: buyer.email || shipment.receiver_email,
      buyerPhone,
      buyerDocType: ident.type,
      buyerDocNumber: ident.number,
      billing:
        billingName || billingDocNumber
          ? {
              name: billingName,
              docType: billingDocType,
              docNumber: billingDocNumber,
              email: additional.EMAIL || buyer.email,
              phone: additional.PHONE,
              // Presence of BUSINESS_NAME or ECONOMIC_ACTIVITY = factura empresa.
              // Otherwise it's a boleta (consumer).
              invoiceType:
                additional.BUSINESS_NAME || additional.ECONOMIC_ACTIVITY
                  ? 'factura'
                  : 'boleta',
              economicActivity: additional.ECONOMIC_ACTIVITY,
              taxContributor: additional.TAX_CONTRIBUTOR,
            }
          : undefined,
      items: (data.order_items || []).map((item: any) => ({
        externalId: String(item.item?.id),
        sku: item.item?.seller_custom_field || item.item?.id,
        title: item.item?.title,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        totalPrice: (item.full_unit_price ?? item.unit_price) * item.quantity,
      })),
      subtotal: data.total_amount,
      shippingCost: shipment.shipping_option?.cost || data.shipping?.cost || 0,
      total: data.total_amount,
      currency: data.currency_id,
      shippingAddress: receiver.street_name || receiver.address_line
        ? {
            name: buyerName,
            address1: receiver.address_line ||
              `${receiver.street_name || ''} ${receiver.street_number || ''}`.trim(),
            city: receiver.city?.name || receiver.city || '',
            state: receiver.state?.name || receiver.state,
            zipCode: receiver.zip_code,
            country: receiver.country?.id || receiver.country || 'CL',
            phone: buyerPhone,
          }
        : undefined,
      billingAddress:
        billingAddressLine
          ? {
              name: billingName || '',
              address1: billingAddressLine,
              city: additional.CITY_NAME || '',
              state: additional.STATE_NAME,
              zipCode: additional.ZIP_CODE,
              country: additional.COUNTRY_ID || 'CL',
            }
          : undefined,
      createdAt: new Date(data.date_created),
      updatedAt: new Date(data.last_updated),
      rawData: data,
    }
  }

  private mapStatus(status: string): MarketplaceProduct['status'] {
    const map: Record<string, MarketplaceProduct['status']> = {
      active: 'active',
      paused: 'paused',
      closed: 'closed',
      under_review: 'unknown',
      inactive: 'paused',
    }
    return map[status] || 'unknown'
  }

  private chunkArray<T>(arr: T[], size: number): T[][] {
    return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
      arr.slice(i * size, i * size + size),
    )
  }
}
