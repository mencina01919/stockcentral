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

export class WooCommerceDriver implements IMarketplaceDriver {
  readonly provider = 'woocommerce'

  private buildClient(credentials: DriverCredentials): AxiosInstance {
    const { siteUrl, consumerKey, consumerSecret } = credentials
    const base = siteUrl.replace(/\/$/, '')
    return axios.create({
      baseURL: `${base}/wp-json/wc/v3`,
      auth: { username: consumerKey, password: consumerSecret },
      timeout: 15000,
    })
  }

  async testConnection(credentials: DriverCredentials): Promise<ConnectionTestResult> {
    try {
      const client = this.buildClient(credentials)
      const res = await client.get('/system_status')
      return {
        success: true,
        shopName: res.data.settings?.title || credentials.siteUrl,
        shopUrl: credentials.siteUrl,
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
    const client = this.buildClient(credentials)
    const page = Math.floor(offset / limit) + 1

    const res = await client.get('/products', {
      params: { per_page: limit, page, status: 'publish' },
    })

    const total = parseInt(res.headers['x-wp-total'] || '0', 10)
    const products = res.data.map((p: any) => this.mapProduct(p))

    return { items: products, total, offset, limit, hasMore: offset + limit < total }
  }

  async getProduct(credentials: DriverCredentials, externalId: string): Promise<MarketplaceProduct | null> {
    try {
      const client = this.buildClient(credentials)
      const res = await client.get(`/products/${externalId}`)
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
      const client = this.buildClient(credentials)
      const cfg = (config || {}) as Record<string, unknown>

      const payload: Record<string, unknown> = {
        name: product.title,
        type: 'simple',
        regular_price: product.price.toFixed(2),
        description: product.description || '',
        sku: product.sku,
        manage_stock: true,
        stock_quantity: product.stock,
        status: 'publish',
        images: product.images?.map((src) => ({ src })) || [],
        categories: product.categoryId ? [{ id: parseInt(product.categoryId, 10) }] : [],
      }

      const res = await client.post('/products', payload)
      return { success: true, externalId: String(res.data.id), rawResponse: res.data }
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
      const client = this.buildClient(credentials)
      const payload: Record<string, unknown> = {}

      if (product.title) payload.name = product.title
      if (product.description) payload.description = product.description
      if (product.price !== undefined) payload.regular_price = product.price.toFixed(2)
      if (product.stock !== undefined) {
        payload.manage_stock = true
        payload.stock_quantity = product.stock
      }

      await client.put(`/products/${externalId}`, payload)
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
    const client = this.buildClient(credentials)
    const page = Math.floor(offset / limit) + 1
    const params: Record<string, unknown> = { per_page: limit, page }
    if (since) params.after = since.toISOString()

    const res = await client.get('/orders', { params })
    const total = parseInt(res.headers['x-wp-total'] || '0', 10)
    const orders = res.data.map((o: any) => this.mapOrder(o))

    return { items: orders, total, offset, limit, hasMore: offset + limit < total }
  }

  async getOrder(credentials: DriverCredentials, externalId: string): Promise<MarketplaceOrder | null> {
    try {
      const client = this.buildClient(credentials)
      const res = await client.get(`/orders/${externalId}`)
      return this.mapOrder(res.data)
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
      price: parseFloat(data.regular_price || data.price || '0'),
      stock: data.stock_quantity ?? 0,
      images: data.images?.map((img: any) => img.src) || [],
      categoryId: data.categories?.[0]?.id?.toString(),
      status: data.status === 'publish' ? 'active' : 'paused',
      url: data.permalink,
      rawData: data,
    }
  }

  private mapOrder(data: any): MarketplaceOrder {
    const shipping = data.shipping
    return {
      externalId: String(data.id),
      externalOrderNumber: String(data.number),
      status: data.status,
      buyerName: `${data.billing?.first_name || ''} ${data.billing?.last_name || ''}`.trim(),
      buyerEmail: data.billing?.email,
      buyerPhone: data.billing?.phone,
      items: (data.line_items || []).map((item: any) => ({
        externalId: String(item.id),
        sku: item.sku || String(item.product_id),
        title: item.name,
        quantity: item.quantity,
        unitPrice: parseFloat(item.price),
        totalPrice: parseFloat(item.total),
      })),
      subtotal: parseFloat(data.subtotal || '0'),
      shippingCost: parseFloat(data.shipping_total || '0'),
      total: parseFloat(data.total || '0'),
      currency: data.currency,
      shippingAddress: shipping?.address_1
        ? {
            name: `${shipping.first_name || ''} ${shipping.last_name || ''}`.trim(),
            address1: shipping.address_1,
            address2: shipping.address_2,
            city: shipping.city,
            state: shipping.state,
            zipCode: shipping.postcode,
            country: shipping.country,
            phone: data.billing?.phone,
          }
        : undefined,
      createdAt: new Date(data.date_created),
      updatedAt: new Date(data.date_modified),
      rawData: data,
    }
  }
}
