export interface DriverCredentials {
  [key: string]: string
}

export interface DriverConfig {
  [key: string]: unknown
}

export interface MarketplaceProduct {
  externalId: string
  externalSku?: string
  title: string
  description?: string
  price: number
  stock: number
  images?: string[]
  categoryId?: string
  status: 'active' | 'paused' | 'closed' | 'unknown'
  url?: string
  rawData?: unknown
}

export interface MarketplaceOrder {
  externalId: string
  externalOrderNumber?: string
  status: string
  buyerName: string
  buyerEmail?: string
  buyerPhone?: string
  items: MarketplaceOrderItem[]
  subtotal: number
  shippingCost: number
  total: number
  currency: string
  shippingAddress?: MarketplaceAddress
  createdAt: Date
  updatedAt: Date
  rawData?: unknown
}

export interface MarketplaceOrderItem {
  externalId?: string
  sku: string
  title: string
  quantity: number
  unitPrice: number
  totalPrice: number
}

export interface MarketplaceAddress {
  name: string
  address1: string
  address2?: string
  city: string
  state?: string
  zipCode?: string
  country: string
  phone?: string
}

export interface SyncProductInput {
  sku: string
  title: string
  description?: string
  price: number
  stock: number
  images?: string[]
  categoryId?: string
  externalId?: string
}

export interface SyncResult {
  success: boolean
  externalId?: string
  error?: string
  rawResponse?: unknown
}

export interface ConnectionTestResult {
  success: boolean
  shopName?: string
  shopUrl?: string
  sellerId?: string
  error?: string
}

export interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  expiresAt?: Date
  sellerId?: string
  siteId?: string
  scope?: string
}

export interface PaginatedResult<T> {
  items: T[]
  total: number
  offset: number
  limit: number
  hasMore: boolean
}

export type WebhookEvent =
  | 'orders.created'
  | 'orders.updated'
  | 'orders.cancelled'
  | 'products.updated'
  | 'inventory.updated'

export interface IMarketplaceDriver {
  provider: string

  testConnection(credentials: DriverCredentials, config?: DriverConfig): Promise<ConnectionTestResult>

  getProducts(
    credentials: DriverCredentials,
    config?: DriverConfig,
    offset?: number,
    limit?: number,
  ): Promise<PaginatedResult<MarketplaceProduct>>

  getProduct(
    credentials: DriverCredentials,
    externalId: string,
    config?: DriverConfig,
  ): Promise<MarketplaceProduct | null>

  createProduct(
    credentials: DriverCredentials,
    product: SyncProductInput,
    config?: DriverConfig,
  ): Promise<SyncResult>

  updateProduct(
    credentials: DriverCredentials,
    externalId: string,
    product: Partial<SyncProductInput>,
    config?: DriverConfig,
  ): Promise<SyncResult>

  updateStock(
    credentials: DriverCredentials,
    externalId: string,
    stock: number,
    config?: DriverConfig,
  ): Promise<SyncResult>

  getOrders(
    credentials: DriverCredentials,
    config?: DriverConfig,
    since?: Date,
    offset?: number,
    limit?: number,
  ): Promise<PaginatedResult<MarketplaceOrder>>

  getOrder(
    credentials: DriverCredentials,
    externalId: string,
    config?: DriverConfig,
  ): Promise<MarketplaceOrder | null>

  confirmOrder?(
    credentials: DriverCredentials,
    externalId: string,
    config?: DriverConfig,
  ): Promise<SyncResult>

  getAuthUrl?(config: DriverConfig): string

  exchangeCode?(code: string, config: DriverConfig): Promise<OAuthTokens>

  refreshToken?(refreshToken: string, config: DriverConfig): Promise<OAuthTokens>
}
