export interface ApiResponse<T> {
  data: T
  message?: string
}

export interface PaginatedResponse<T> {
  data: T[]
  meta: PaginationMeta
}

export interface PaginationMeta {
  total: number
  page: number
  limit: number
  totalPages: number
  hasNextPage: boolean
  hasPrevPage: boolean
}

export interface PaginationQuery {
  page?: number
  limit?: number
  search?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export interface LoginDto {
  email: string
  password: string
}

export interface RegisterDto {
  email: string
  password: string
  firstName: string
  lastName: string
  tenantName: string
  country?: string
  currency?: string
}

export interface CreateProductDto {
  sku: string
  name: string
  description?: string
  shortDescription?: string
  basePrice: number
  costPrice?: number
  weight?: number
  tags?: string[]
  status?: string
}

export interface UpdateProductDto extends Partial<CreateProductDto> {}

export interface CreateOrderDto {
  source: string
  sourceChannel: string
  externalOrderId?: string
  customerName: string
  customerEmail?: string
  items: CreateOrderItemDto[]
  subtotal: number
  total: number
  currency?: string
}

export interface CreateOrderItemDto {
  sku: string
  name: string
  quantity: number
  unitPrice: number
  totalPrice: number
  productId?: string
}

export interface UpdateInventoryDto {
  quantity: number
  reason?: string
}

export interface CreateConnectionDto {
  type: string
  provider: string
  name: string
  credentials: Record<string, string>
  config?: Record<string, unknown>
}

export interface DashboardStats {
  totalSales: number
  totalOrders: number
  totalProducts: number
  totalConnections: number
  salesChange: number
  ordersChange: number
  productsSynced: number
  recentOrders: RecentOrder[]
  salesByChannel: SalesByChannel[]
  topProducts: TopProduct[]
  connectionStatus: ConnectionStatusItem[]
}

export interface RecentOrder {
  id: string
  orderNumber: string
  channel: string
  total: number
  status: string
  createdAt: Date
}

export interface SalesByChannel {
  channel: string
  sales: number
  orders: number
}

export interface TopProduct {
  id: string
  name: string
  sku: string
  sales: number
  revenue: number
}

export interface ConnectionStatusItem {
  id: string
  name: string
  provider: string
  status: string
  lastSync?: Date
}
