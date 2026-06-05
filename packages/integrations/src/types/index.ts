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
  packId?: string
  status: string
  // Sub-estado del marketplace cuando lo expone (ML: status_detail).
  // Útil para distinguir "cancelled" por mediación, no entregado, devolución, etc.
  statusDetail?: string
  // Tags del marketplace (ML: tags). Ej: ['mediations','not_delivered','claim'].
  tags?: string[]
  // Si la orden tiene mediaciones/reclamos abiertos en el marketplace.
  hasMediations?: boolean
  buyerName: string
  buyerEmail?: string
  buyerPhone?: string
  buyerDocType?: string
  buyerDocNumber?: string
  billing?: MarketplaceBilling
  items: MarketplaceOrderItem[]
  subtotal: number
  shippingCost: number
  total: number
  currency: string
  shippingAddress?: MarketplaceAddress
  billingAddress?: MarketplaceAddress
  createdAt: Date
  updatedAt: Date
  rawData?: unknown
}

export interface MarketplaceBilling {
  name?: string
  docType?: string
  docNumber?: string
  email?: string
  phone?: string
  invoiceType?: 'boleta' | 'factura'
  economicActivity?: string
  taxContributor?: string
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

// What a driver can do as a master-catalog source. Read by the catalog
// service to decide which UI options to expose and which sync flows to run.
export interface CatalogCapabilities {
  // Can be selected as the master catalog source (must implement getProducts).
  canBeCatalogSource: boolean
  // The product list is paginated; the service will iterate all pages on import.
  supportsPagination: boolean
  // The driver returns a meaningful stock value per product.
  providesStock: boolean
  // The driver returns price information.
  providesPrices: boolean
  // The driver returns product images.
  providesImages: boolean
  // The driver exposes a single-product endpoint for refresh-by-id.
  supportsSingleProductFetch: boolean
  // El driver es catalog source pero TAMBIÉN recibe fan-out de stock cuando
  // se vende algo en otros markets (ej. WonderStore: importa catálogo y
  // expone POST /stock/reduce). Por default (undefined/false), un catalog
  // source es solo-lectura y queda excluido del fan-out de stock.
  acceptsStockSync?: boolean
}

export interface IMarketplaceDriver {
  provider: string

  // When false, the scheduled outbound product sync skips this provider.
  // Drivers whose upstream API only exposes read endpoints should set this to false.
  // Defaults to true (the cron treats undefined as "supports writes").
  supportsWriteSync?: boolean

  // Optional. If absent, the driver is treated as NOT a catalog source.
  catalogCapabilities?: CatalogCapabilities

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

  // Search marketplace listings by seller SKU. Returns:
  //  - 0 matches → not published in this marketplace
  //  - 1 match  → auto-link
  //  - 2+ matches → ambiguous, user must resolve
  // title (opcional) sirve de fallback cuando el marketplace no soporta
  // filtro por SKU o cuando el seller_custom_field está vacío en el item.
  findBySku?(
    credentials: DriverCredentials,
    sku: string,
    config?: DriverConfig,
    title?: string,
  ): Promise<MarketplaceProduct[]>

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

  updateImages?(
    credentials: DriverCredentials,
    externalId: string,
    imageUrls: string[],
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
