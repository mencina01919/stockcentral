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
    const orders: MarketplaceOrder[] = res.data.results.map((o: any) => this.mapOrder(o))
    const total = res.data.paging.total

    return { items: orders, total, offset, limit, hasMore: offset + limit < total }
  }

  async getOrder(credentials: DriverCredentials, externalId: string): Promise<MarketplaceOrder | null> {
    try {
      const client = this.buildClient(credentials.accessToken)
      const res = await client.get(`/orders/${externalId}`)
      return this.mapOrder(res.data)
    } catch {
      return null
    }
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
    return {
      externalId: String(data.id),
      externalOrderNumber: String(data.id),
      status: data.status,
      buyerName: data.buyer
        ? `${data.buyer.first_name || ''} ${data.buyer.last_name || ''}`.trim()
        : 'Unknown',
      buyerEmail: data.buyer?.email,
      items: (data.order_items || []).map((item: any) => ({
        externalId: String(item.item?.id),
        sku: item.item?.seller_custom_field || item.item?.id,
        title: item.item?.title,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        totalPrice: (item.full_unit_price ?? item.unit_price) * item.quantity,
      })),
      subtotal: data.total_amount,
      shippingCost: data.shipping?.cost || 0,
      total: data.total_amount,
      currency: data.currency_id,
      shippingAddress: data.shipping?.receiver_address
        ? {
            name: data.buyer?.first_name || '',
            address1: data.shipping.receiver_address.street_name + ' ' + data.shipping.receiver_address.street_number,
            city: data.shipping.receiver_address.city?.name || '',
            state: data.shipping.receiver_address.state?.name,
            zipCode: data.shipping.receiver_address.zip_code,
            country: data.shipping.receiver_address.country?.id || 'CL',
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
