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
  CatalogCapabilities,
} from '../types'

// EYLSTORE — read-only ecommerce integration.
// API: https://api.eylstore.cl/api/external
// Auth: API key sent via header X-EXTERNAL-API-KEY (or query param api_key).
// Endpoints exposed: GET /products (paginated), GET /products/{slug}.
// Writes (createProduct, updateProduct, updateStock, getOrders, getOrder)
// are not yet exposed by the upstream API and return a clear error.

const DEFAULT_BASE_URL = 'https://api.eylstore.cl/api/external'
const NOT_IMPLEMENTED_ERROR =
  'EYLSTORE API expone solo lectura por ahora. La escritura (productos, stock, órdenes) no está disponible.'

export class EylstoreDriver implements IMarketplaceDriver {
  readonly provider = 'eylstore'
  readonly supportsWriteSync = false
  readonly catalogCapabilities: CatalogCapabilities = {
    canBeCatalogSource: true,
    supportsPagination: true,
    providesStock: true,
    providesPrices: true,
    providesImages: true,
    supportsSingleProductFetch: true,
  }

  private buildClient(credentials: DriverCredentials, config?: DriverConfig): AxiosInstance {
    const baseURL = (config?.baseUrl as string) || DEFAULT_BASE_URL
    return axios.create({
      baseURL,
      timeout: 20000,
      headers: {
        'X-EXTERNAL-API-KEY': credentials.apiKey,
        Accept: 'application/json',
      },
    })
  }

  async testConnection(credentials: DriverCredentials, config?: DriverConfig): Promise<ConnectionTestResult> {
    try {
      const client = this.buildClient(credentials, config)
      const res = await client.get('/products', { params: { page: 1 } })
      const total = res.data?.meta?.total
      return {
        success: true,
        shopName: 'EYLSTORE',
        shopUrl: 'https://eylstore.cl',
        sellerId: typeof total === 'number' ? `${total} productos` : undefined,
      }
    } catch (err: any) {
      return {
        success: false,
        error: err?.response?.data?.message || err?.response?.data?.error || err.message,
      }
    }
  }

  async getProducts(
    credentials: DriverCredentials,
    config?: DriverConfig,
    offset = 0,
    limit = 50,
  ): Promise<PaginatedResult<MarketplaceProduct>> {
    const client = this.buildClient(credentials, config)
    // EYLSTORE paginates by ?page=N (per_page=50 fixed upstream).
    const perPage = 50
    const page = Math.floor(offset / perPage) + 1
    const res = await client.get('/products', { params: { page } })
    const data: any[] = res.data?.data || []
    const meta = res.data?.meta || {}
    const total: number = meta.total ?? data.length

    // If caller asked for a window smaller than perPage, slice it.
    const skipInPage = offset - (page - 1) * perPage
    const items = data.slice(skipInPage, skipInPage + limit).map((p) => this.mapProduct(p))

    return {
      items,
      total,
      offset,
      limit,
      hasMore: offset + items.length < total,
    }
  }

  async getProduct(
    credentials: DriverCredentials,
    externalId: string,
    config?: DriverConfig,
  ): Promise<MarketplaceProduct | null> {
    try {
      const client = this.buildClient(credentials, config)
      // externalId can be the slug (preferred) or the numeric id; EYLSTORE accepts the slug.
      const res = await client.get(`/products/${encodeURIComponent(externalId)}`)
      const raw = res.data?.data || res.data
      return raw ? this.mapProduct(raw) : null
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
    // EYLSTORE has no /products?sku=X filter, so we paginate and match locally.
    // Catalog is ~640 items today, so this is fine; revisit if it grows large.
    const client = this.buildClient(credentials, config)
    const matches: MarketplaceProduct[] = []
    const target = String(sku).toLowerCase()
    let page = 1
    let lastPage = 1
    do {
      const res = await client.get('/products', { params: { page } })
      const data: any[] = res.data?.data || []
      lastPage = res.data?.meta?.last_page ?? page
      for (const p of data) {
        if (String(p.sku ?? '').toLowerCase() === target) matches.push(this.mapProduct(p))
      }
      if (matches.length) return matches
      page++
    } while (page <= lastPage)
    return matches
  }

  async createProduct(): Promise<SyncResult> {
    return { success: false, error: NOT_IMPLEMENTED_ERROR }
  }

  async updateProduct(): Promise<SyncResult> {
    return { success: false, error: NOT_IMPLEMENTED_ERROR }
  }

  async updateStock(): Promise<SyncResult> {
    return { success: false, error: NOT_IMPLEMENTED_ERROR }
  }

  async getOrders(
    _credentials: DriverCredentials,
    _config?: DriverConfig,
    _since?: Date,
    offset = 0,
    limit = 50,
  ): Promise<PaginatedResult<MarketplaceOrder>> {
    return { items: [], total: 0, offset, limit, hasMore: false }
  }

  async getOrder(): Promise<MarketplaceOrder | null> {
    return null
  }

  private mapProduct(data: any): MarketplaceProduct {
    const prices = data.prices || {}
    const price =
      Number(prices.normal) ||
      Number(prices.card) ||
      Number(prices.transfer) ||
      0
    const stock = Number(data.stock?.total ?? 0)
    const images: string[] = []
    if (data.images?.main) images.push(data.images.main)
    if (Array.isArray(data.images?.gallery)) {
      for (const url of data.images.gallery) {
        if (typeof url === 'string' && !images.includes(url)) images.push(url)
      }
    }
    const slug = data.slug || String(data.id)
    return {
      externalId: slug,
      externalSku: data.sku != null ? String(data.sku) : undefined,
      title: data.name || '',
      description: typeof data.description === 'string' ? data.description : undefined,
      price,
      stock,
      images,
      categoryId: data.category?.slug || (data.category?.id != null ? String(data.category.id) : undefined),
      status: stock > 0 ? 'active' : 'paused',
      url: `https://eylstore.cl/producto/${slug}`,
      rawData: data,
    }
  }
}
