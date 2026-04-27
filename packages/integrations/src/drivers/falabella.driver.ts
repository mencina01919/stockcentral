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

// Falabella Seller Center API (based on MIRAKL platform)
const FALABELLA_API = 'https://sellercenter.falabella.com/api'

export class FalabellaDriver implements IMarketplaceDriver {
  readonly provider = 'falabella'

  private buildSignature(
    params: Record<string, string>,
    apiSecret: string,
  ): string {
    const sorted = Object.keys(params)
      .sort()
      .map((k) => `${k}${params[k]}`)
      .join('')
    return crypto.createHmac('sha256', apiSecret).update(sorted).digest('hex')
  }

  private buildClient(credentials: DriverCredentials): AxiosInstance {
    return axios.create({
      baseURL: FALABELLA_API,
      timeout: 20000,
    })
  }

  private buildParams(
    credentials: DriverCredentials,
    action: string,
    extra: Record<string, string> = {},
  ): Record<string, string> {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19)
    const params: Record<string, string> = {
      Action: action,
      Format: 'JSON',
      Timestamp: timestamp,
      UserID: credentials.userId,
      Version: '1.0',
      ...extra,
    }
    params.Signature = this.buildSignature(params, credentials.apiSecret)
    return params
  }

  async testConnection(credentials: DriverCredentials): Promise<ConnectionTestResult> {
    try {
      const client = this.buildClient(credentials)
      const params = this.buildParams(credentials, 'GetSeller')
      const res = await client.get('/', { params })
      const seller = res.data?.SuccessResponse?.Body?.Seller
      return {
        success: true,
        shopName: seller?.Name || credentials.userId,
        sellerId: credentials.userId,
      }
    } catch (err: any) {
      return { success: false, error: err?.response?.data?.ErrorResponse?.Head?.ErrorMessage || err.message }
    }
  }

  async getProducts(
    credentials: DriverCredentials,
    config?: DriverConfig,
    offset = 0,
    limit = 50,
  ): Promise<PaginatedResult<MarketplaceProduct>> {
    const client = this.buildClient(credentials)
    const params = this.buildParams(credentials, 'GetProducts', {
      Offset: String(offset),
      Limit: String(limit),
      Filter: 'all',
    })

    const res = await client.get('/', { params })
    const body = res.data?.SuccessResponse?.Body
    const products = (body?.Products?.Product || []).map((p: any) => this.mapProduct(p))
    const total = parseInt(body?.TotalCount || '0', 10)

    return { items: products, total, offset, limit, hasMore: offset + limit < total }
  }

  async getProduct(credentials: DriverCredentials, externalId: string): Promise<MarketplaceProduct | null> {
    try {
      const client = this.buildClient(credentials)
      const params = this.buildParams(credentials, 'GetProducts', { SkuSellerList: JSON.stringify([externalId]) })
      const res = await client.get('/', { params })
      const product = res.data?.SuccessResponse?.Body?.Products?.Product?.[0]
      return product ? this.mapProduct(product) : null
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

      const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<Request>
  <Product>
    <SellerSku>${product.sku}</SellerSku>
    <Name>${product.title}</Name>
    <Description>${product.description || product.title}</Description>
    <Brand>${cfg.brand || 'Generic'}</Brand>
    <Price>${product.price}</Price>
    <SalePrice>${product.price}</SalePrice>
    <SaleStartDate>${new Date().toISOString().split('T')[0]}</SaleStartDate>
    <SaleEndDate>${new Date(Date.now() + 365 * 86400000).toISOString().split('T')[0]}</SaleEndDate>
    <Status>active</Status>
    <Quantity>${product.stock}</Quantity>
    <PrimaryCategory>${product.categoryId || cfg.defaultCategoryId || ''}</PrimaryCategory>
    <Images>
      ${product.images?.map((url) => `<Image>${url}</Image>`).join('\n      ') || ''}
    </Images>
  </Product>
</Request>`

      const params = this.buildParams(credentials, 'ProductCreate')
      const res = await client.post('/', xmlPayload, {
        params,
        headers: { 'Content-Type': 'text/xml' },
      })

      const skuList = res.data?.SuccessResponse?.Body?.RequestId
      return { success: true, externalId: product.sku, rawResponse: res.data }
    } catch (err: any) {
      return { success: false, error: err?.response?.data?.ErrorResponse?.Head?.ErrorMessage || err.message }
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
      const updates: string[] = [`<SellerSku>${externalId}</SellerSku>`]
      if (product.title) updates.push(`<Name>${product.title}</Name>`)
      if (product.price !== undefined) updates.push(`<Price>${product.price}</Price>`)
      if (product.stock !== undefined) updates.push(`<Quantity>${product.stock}</Quantity>`)

      const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?><Request><Product>${updates.join('')}</Product></Request>`
      const params = this.buildParams(credentials, 'ProductUpdate')

      await client.post('/', xmlPayload, {
        params,
        headers: { 'Content-Type': 'text/xml' },
      })

      return { success: true, externalId }
    } catch (err: any) {
      return { success: false, error: err?.response?.data?.ErrorResponse?.Head?.ErrorMessage || err.message }
    }
  }

  async updateStock(
    credentials: DriverCredentials,
    externalId: string,
    stock: number,
  ): Promise<SyncResult> {
    try {
      const client = this.buildClient(credentials)
      const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<Request>
  <Product>
    <SellerSku>${externalId}</SellerSku>
    <Quantity>${stock}</Quantity>
  </Product>
</Request>`
      const params = this.buildParams(credentials, 'ProductUpdate')
      await client.post('/', xmlPayload, {
        params,
        headers: { 'Content-Type': 'text/xml' },
      })
      return { success: true, externalId }
    } catch (err: any) {
      return { success: false, error: err?.response?.data?.ErrorResponse?.Head?.ErrorMessage || err.message }
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
    const extra: Record<string, string> = {
      Offset: String(offset),
      Limit: String(limit),
      SortBy: 'created_at',
      SortDirection: 'DESC',
    }
    if (since) {
      extra.CreatedAfter = since.toISOString().replace('T', ' ').substring(0, 19)
    }

    const params = this.buildParams(credentials, 'GetOrders', extra)
    const res = await client.get('/', { params })
    const body = res.data?.SuccessResponse?.Body
    const orders = (body?.Orders?.Order || []).map((o: any) => this.mapOrder(o))
    const total = parseInt(body?.CountTotal || '0', 10)

    return { items: orders, total, offset, limit, hasMore: offset + limit < total }
  }

  async getOrder(credentials: DriverCredentials, externalId: string): Promise<MarketplaceOrder | null> {
    try {
      const client = this.buildClient(credentials)
      const params = this.buildParams(credentials, 'GetOrder', { OrderId: externalId })
      const res = await client.get('/', { params })
      const order = res.data?.SuccessResponse?.Body?.Orders?.Order?.[0]
      return order ? this.mapOrder(order) : null
    } catch {
      return null
    }
  }

  private mapProduct(data: any): MarketplaceProduct {
    return {
      externalId: data.SellerSku,
      externalSku: data.SellerSku,
      title: data.Name,
      description: data.Description,
      price: parseFloat(data.Price || '0'),
      stock: parseInt(data.Quantity || '0', 10),
      images: data.Images?.Image ? (Array.isArray(data.Images.Image) ? data.Images.Image : [data.Images.Image]) : [],
      status: data.Status === 'active' ? 'active' : 'paused',
      rawData: data,
    }
  }

  private mapOrder(data: any): MarketplaceOrder {
    return {
      externalId: String(data.OrderId),
      externalOrderNumber: String(data.OrderNumber || data.OrderId),
      status: data.Status,
      buyerName: data.CustomerFirstName
        ? `${data.CustomerFirstName} ${data.CustomerLastName || ''}`.trim()
        : 'Unknown',
      buyerEmail: data.CustomerEmail,
      items: (data.OrderItems?.OrderItem || []).map((item: any) => ({
        externalId: String(item.OrderItemId),
        sku: item.Sku,
        title: item.Name,
        quantity: parseInt(item.QtyOrdered || '1', 10),
        unitPrice: parseFloat(item.PaidPrice || item.Price || '0'),
        totalPrice: parseFloat(item.PaidPrice || '0') * parseInt(item.QtyOrdered || '1', 10),
      })),
      subtotal: parseFloat(data.Price || '0'),
      shippingCost: 0,
      total: parseFloat(data.Price || '0'),
      currency: 'CLP',
      shippingAddress: data.AddressShipping
        ? {
            name: data.AddressShipping.FirstName + ' ' + (data.AddressShipping.LastName || ''),
            address1: data.AddressShipping.Address1,
            address2: data.AddressShipping.Address2,
            city: data.AddressShipping.City,
            state: data.AddressShipping.Ward,
            zipCode: data.AddressShipping.PostCode,
            country: data.AddressShipping.Country || 'CL',
            phone: data.AddressShipping.Phone,
          }
        : undefined,
      createdAt: new Date(data.CreatedAt),
      updatedAt: new Date(data.UpdatedAt || data.CreatedAt),
      rawData: data,
    }
  }
}
