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

const JS_API = 'https://api.jumpseller.com/v1'
const JS_AUTH = 'https://www.jumpseller.com/api/oauth'

export class JumpsellerDriver implements IMarketplaceDriver {
  readonly provider = 'jumpseller'

  private buildClient(credentials: DriverCredentials): AxiosInstance {
    return axios.create({
      baseURL: JS_API,
      params: {
        login: credentials.login,
        authtoken: credentials.authToken,
      },
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    })
  }

  getAuthUrl(config: DriverConfig): string {
    const { clientId, redirectUri } = config as Record<string, string>
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
    })
    return `${JS_AUTH}/authorize?${params.toString()}`
  }

  async exchangeCode(code: string, config: DriverConfig): Promise<OAuthTokens> {
    const { clientId, clientSecret, redirectUri } = config as Record<string, string>
    const res = await axios.post(`${JS_AUTH}/token`, {
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    })
    return {
      accessToken: res.data.access_token,
      refreshToken: res.data.refresh_token,
      expiresAt: new Date(Date.now() + (res.data.expires_in || 3600) * 1000),
    }
  }

  async refreshToken(refreshToken: string, config: DriverConfig): Promise<OAuthTokens> {
    const { clientId, clientSecret } = config as Record<string, string>
    const res = await axios.post(`${JS_AUTH}/token`, {
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    })
    return {
      accessToken: res.data.access_token,
      refreshToken: res.data.refresh_token,
      expiresAt: new Date(Date.now() + (res.data.expires_in || 3600) * 1000),
    }
  }

  async testConnection(credentials: DriverCredentials): Promise<ConnectionTestResult> {
    try {
      const client = this.buildClient(credentials)
      const res = await client.get('/store.json')
      return {
        success: true,
        shopName: res.data.store?.name || credentials.login,
        shopUrl: res.data.store?.url,
      }
    } catch (err: any) {
      return { success: false, error: err?.response?.data?.error || err.message }
    }
  }

  async getProducts(
    credentials: DriverCredentials,
    config?: DriverConfig,
    offset = 0,
    limit = 50,
  ): Promise<PaginatedResult<MarketplaceProduct>> {
    const client = this.buildClient(credentials)
    const page = Math.floor(offset / limit) + 1

    const res = await client.get('/products.json', { params: { page, limit } })
    const products = (res.data || []).map((p: any) => this.mapProduct(p.product || p))

    // Jumpseller doesn't return total count easily; estimate
    const hasMore = products.length === limit
    return { items: products, total: offset + products.length + (hasMore ? 1 : 0), offset, limit, hasMore }
  }

  async getProduct(credentials: DriverCredentials, externalId: string): Promise<MarketplaceProduct | null> {
    try {
      const client = this.buildClient(credentials)
      const res = await client.get(`/products/${externalId}.json`)
      const data = res.data?.product || res.data
      return data ? this.mapProduct(data) : null
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
      const client = this.buildClient(credentials)
      const cfg = (config || {}) as Record<string, unknown>

      const payload = {
        product: {
          name: product.title,
          price: product.price,
          stock: product.stock,
          description: product.description || '',
          sku: product.sku,
          status: 'available',
          categories: product.categoryId ? [{ id: parseInt(product.categoryId, 10) }] : [],
          images: product.images?.map((url) => ({ url })) || [],
        },
      }

      const res = await client.post('/products.json', payload)
      const created = res.data?.product || res.data
      return { success: true, externalId: String(created.id), rawResponse: created }
    } catch (err: any) {
      return { success: false, error: err?.response?.data?.error || err.message }
    }
  }

  async updateProduct(
    credentials: DriverCredentials,
    externalId: string,
    product: Partial<SyncProductInput>,
    config?: DriverConfig,
  ): Promise<SyncResult> {
    try {
      const client = this.buildClient(credentials)
      const payload: Record<string, unknown> = { product: {} }
      const p = payload.product as Record<string, unknown>

      if (product.title) p.name = product.title
      if (product.description) p.description = product.description
      if (product.price !== undefined) p.price = product.price
      if (product.stock !== undefined) p.stock = product.stock

      await client.put(`/products/${externalId}.json`, payload)
      return { success: true, externalId }
    } catch (err: any) {
      return { success: false, error: err?.response?.data?.error || err.message }
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
    const client = this.buildClient(credentials)
    const page = Math.floor(offset / limit) + 1
    const params: Record<string, unknown> = { page, limit }
    if (since) params.since = since.toISOString()

    const res = await client.get('/orders.json', { params })
    const orders = (res.data || []).map((o: any) => this.mapOrder(o.order || o))
    const hasMore = orders.length === limit

    return { items: orders, total: offset + orders.length + (hasMore ? 1 : 0), offset, limit, hasMore }
  }

  async getOrder(credentials: DriverCredentials, externalId: string): Promise<MarketplaceOrder | null> {
    try {
      const client = this.buildClient(credentials)
      const res = await client.get(`/orders/${externalId}.json`)
      const data = res.data?.order || res.data
      return data ? this.mapOrder(data) : null
    } catch {
      return null
    }
  }

  private mapProduct(data: any): MarketplaceProduct {
    return {
      externalId: String(data.id),
      externalSku: data.sku,
      title: data.name,
      description: data.description?.replace(/<[^>]+>/g, '') || '',
      price: parseFloat(data.price || '0'),
      stock: data.stock ?? 0,
      images: (data.images || []).map((img: any) => img.url || img),
      categoryId: data.categories?.[0]?.id?.toString(),
      status: data.status === 'available' ? 'active' : 'paused',
      url: data.url,
      rawData: data,
    }
  }

  private mapOrder(data: any): MarketplaceOrder {
    const customer = data.customer || {}
    const shipping = data.shipping_address || {}
    return {
      externalId: String(data.id),
      externalOrderNumber: String(data.id),
      status: data.status,
      buyerName: customer.name || `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 'Unknown',
      buyerEmail: customer.email,
      buyerPhone: customer.phone,
      items: (data.products || []).map((item: any) => ({
        externalId: String(item.id),
        sku: item.sku || String(item.id),
        title: item.name,
        quantity: item.qty || item.quantity || 1,
        unitPrice: parseFloat(item.price || '0'),
        totalPrice: parseFloat(item.price || '0') * (item.qty || item.quantity || 1),
      })),
      subtotal: parseFloat(data.subtotal || data.total || '0'),
      shippingCost: parseFloat(data.shipping || '0'),
      total: parseFloat(data.total || '0'),
      currency: data.currency || 'CLP',
      shippingAddress: shipping.address
        ? {
            name: shipping.name || customer.name || '',
            address1: shipping.address,
            city: shipping.city,
            state: shipping.region,
            zipCode: shipping.zip,
            country: shipping.country || 'CL',
            phone: shipping.phone || customer.phone,
          }
        : undefined,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at || data.created_at),
      rawData: data,
    }
  }
}
