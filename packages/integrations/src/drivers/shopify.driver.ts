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

export class ShopifyDriver implements IMarketplaceDriver {
  readonly provider = 'shopify'

  private buildClient(credentials: DriverCredentials): AxiosInstance {
    const { shopDomain, accessToken, apiKey, apiSecret } = credentials
    const shop = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')
    const auth = accessToken
      ? { Authorization: `Bearer ${accessToken}` }
      : { 'X-Shopify-Access-Token': accessToken }

    return axios.create({
      baseURL: `https://${shop}/admin/api/2024-01`,
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    })
  }

  getAuthUrl(config: DriverConfig): string {
    const { shopDomain, clientId, redirectUri, scopes } = config as Record<string, string>
    const shop = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')
    const defaultScopes = 'read_products,write_products,read_orders,write_orders,read_inventory,write_inventory'
    const params = new URLSearchParams({
      client_id: clientId,
      scope: scopes || defaultScopes,
      redirect_uri: redirectUri,
      state: Math.random().toString(36).substring(2),
    })
    return `https://${shop}/admin/oauth/authorize?${params.toString()}`
  }

  async exchangeCode(code: string, config: DriverConfig): Promise<OAuthTokens> {
    const { shopDomain, clientId, clientSecret } = config as Record<string, string>
    const shop = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')
    const res = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id: clientId,
      client_secret: clientSecret,
      code,
    })
    return {
      accessToken: res.data.access_token,
      scope: res.data.scope,
    }
  }

  async testConnection(credentials: DriverCredentials): Promise<ConnectionTestResult> {
    try {
      const client = this.buildClient(credentials)
      const res = await client.get('/shop.json')
      return {
        success: true,
        shopName: res.data.shop.name,
        shopUrl: res.data.shop.domain,
      }
    } catch (err: any) {
      return { success: false, error: err?.response?.data?.errors || err.message }
    }
  }

  async getProducts(
    credentials: DriverCredentials,
    config?: DriverConfig,
    offset = 0,
    limit = 50,
  ): Promise<PaginatedResult<MarketplaceProduct>> {
    const client = this.buildClient(credentials)
    // Shopify uses cursor-based pagination; we simulate offset with page_info
    const cfg = (config || {}) as Record<string, unknown>
    const pageInfo = cfg.pageInfo as string | undefined

    const params: Record<string, unknown> = { limit, fields: 'id,title,body_html,variants,images,status' }
    if (pageInfo) params.page_info = pageInfo

    const res = await client.get('/products.json', { params })
    const products = res.data.products.map((p: any) => this.mapProduct(p))

    // Extract next page cursor from Link header
    const linkHeader = res.headers['link'] || ''
    const nextMatch = linkHeader.match(/<[^>]*page_info=([^&>]+)[^>]*>;\s*rel="next"/)
    const nextPageInfo = nextMatch ? nextMatch[1] : undefined

    // Get total count
    const countRes = await client.get('/products/count.json')
    const total = countRes.data.count

    return {
      items: products,
      total,
      offset,
      limit,
      hasMore: !!nextPageInfo,
    }
  }

  async getProduct(credentials: DriverCredentials, externalId: string): Promise<MarketplaceProduct | null> {
    try {
      const client = this.buildClient(credentials)
      const res = await client.get(`/products/${externalId}.json`)
      return this.mapProduct(res.data.product)
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
          title: product.title,
          body_html: product.description || '',
          status: 'active',
          variants: [
            {
              sku: product.sku,
              price: product.price.toFixed(2),
              inventory_quantity: product.stock,
              inventory_management: 'shopify',
            },
          ],
          images: product.images?.map((src) => ({ src })) || [],
        },
      }

      const res = await client.post('/products.json', payload)
      const shopifyProduct = res.data.product
      return {
        success: true,
        externalId: String(shopifyProduct.id),
        rawResponse: shopifyProduct,
      }
    } catch (err: any) {
      return { success: false, error: JSON.stringify(err?.response?.data?.errors) || err.message }
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
      const payload: Record<string, unknown> = { product: { id: externalId } }

      if (product.title) (payload.product as any).title = product.title
      if (product.description) (payload.product as any).body_html = product.description
      if (product.price !== undefined) {
        (payload.product as any).variants = [{ price: product.price.toFixed(2) }]
      }

      await client.put(`/products/${externalId}.json`, payload)
      return { success: true, externalId }
    } catch (err: any) {
      return { success: false, error: err?.response?.data?.errors || err.message }
    }
  }

  async updateStock(
    credentials: DriverCredentials,
    externalId: string,
    stock: number,
    config?: DriverConfig,
  ): Promise<SyncResult> {
    try {
      const client = this.buildClient(credentials)

      // Get inventory item ID from product variant
      const productRes = await client.get(`/products/${externalId}.json`, {
        params: { fields: 'variants' },
      })
      const variantId = productRes.data.product.variants?.[0]?.inventory_item_id
      if (!variantId) return { success: false, error: 'No inventory item found' }

      // Get location ID
      const locRes = await client.get('/locations.json')
      const locationId = locRes.data.locations?.[0]?.id
      if (!locationId) return { success: false, error: 'No location found' }

      await client.post('/inventory_levels/set.json', {
        inventory_item_id: variantId,
        location_id: locationId,
        available: stock,
      })

      return { success: true, externalId }
    } catch (err: any) {
      return { success: false, error: err?.response?.data?.errors || err.message }
    }
  }

  async getOrders(
    credentials: DriverCredentials,
    config?: DriverConfig,
    since?: Date,
    offset = 0,
    limit = 50,
  ): Promise<PaginatedResult<MarketplaceOrder>> {
    const client = this.buildClient(credentials)
    const params: Record<string, unknown> = { limit, status: 'any' }
    if (since) params.created_at_min = since.toISOString()

    const res = await client.get('/orders.json', { params })
    const orders = res.data.orders.map((o: any) => this.mapOrder(o))

    const countRes = await client.get('/orders/count.json', { params: { status: 'any' } })

    return {
      items: orders,
      total: countRes.data.count,
      offset,
      limit,
      hasMore: orders.length === limit,
    }
  }

  async getOrder(credentials: DriverCredentials, externalId: string): Promise<MarketplaceOrder | null> {
    try {
      const client = this.buildClient(credentials)
      const res = await client.get(`/orders/${externalId}.json`)
      return this.mapOrder(res.data.order)
    } catch {
      return null
    }
  }

  private mapProduct(data: any): MarketplaceProduct {
    const variant = data.variants?.[0]
    return {
      externalId: String(data.id),
      externalSku: variant?.sku,
      title: data.title,
      description: data.body_html?.replace(/<[^>]+>/g, '') || '',
      price: parseFloat(variant?.price || '0'),
      stock: variant?.inventory_quantity || 0,
      images: data.images?.map((img: any) => img.src) || [],
      status: data.status === 'active' ? 'active' : 'paused',
      rawData: data,
    }
  }

  private mapOrder(data: any): MarketplaceOrder {
    const shipping = data.shipping_address
    return {
      externalId: String(data.id),
      externalOrderNumber: data.name,
      status: data.financial_status,
      buyerName: `${data.customer?.first_name || ''} ${data.customer?.last_name || ''}`.trim() || data.email,
      buyerEmail: data.email,
      buyerPhone: data.phone || data.customer?.phone,
      items: (data.line_items || []).map((item: any) => ({
        externalId: String(item.id),
        sku: item.sku || String(item.product_id),
        title: item.name,
        quantity: item.quantity,
        unitPrice: parseFloat(item.price),
        totalPrice: parseFloat(item.price) * item.quantity,
      })),
      subtotal: parseFloat(data.subtotal_price || '0'),
      shippingCost: parseFloat(data.total_shipping_price_set?.shop_money?.amount || '0'),
      total: parseFloat(data.total_price || '0'),
      currency: data.currency,
      shippingAddress: shipping
        ? {
            name: `${shipping.first_name || ''} ${shipping.last_name || ''}`.trim(),
            address1: shipping.address1,
            address2: shipping.address2,
            city: shipping.city,
            state: shipping.province,
            zipCode: shipping.zip,
            country: shipping.country_code,
            phone: shipping.phone,
          }
        : undefined,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
      rawData: data,
    }
  }
}
