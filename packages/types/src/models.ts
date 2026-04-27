export interface Tenant {
  id: string
  name: string
  slug: string
  email: string
  phone?: string
  country: string
  timezone: string
  currency: string
  language: string
  plan: string
  status: string
  trialEndsAt?: Date
  customDomain?: string
  createdAt: Date
  updatedAt: Date
}

export interface User {
  id: string
  tenantId: string
  email: string
  firstName: string
  lastName: string
  role: string
  permissions?: Record<string, boolean>
  twoFactorEnabled: boolean
  emailVerified: boolean
  status: string
  lastLogin?: Date
  createdAt: Date
  updatedAt: Date
}

export interface Product {
  id: string
  tenantId: string
  sku: string
  name: string
  description?: string
  shortDescription?: string
  basePrice: number
  costPrice?: number
  weight?: number
  dimensions?: Dimensions
  images?: ProductImage[]
  tags: string[]
  status: string
  variants?: ProductVariant[]
  inventory?: InventoryItem[]
  createdAt: Date
  updatedAt: Date
}

export interface ProductVariant {
  id: string
  productId: string
  sku: string
  name: string
  attributes: Record<string, string>
  price?: number
  costPrice?: number
  weight?: number
  barcode?: string
  createdAt: Date
  updatedAt: Date
}

export interface ProductImage {
  url: string
  alt?: string
  position: number
}

export interface Dimensions {
  length: number
  width: number
  height: number
  unit: string
}

export interface InventoryItem {
  id: string
  tenantId: string
  productId: string
  variantId?: string
  warehouseId: string
  quantity: number
  reservedQuantity: number
  availableQuantity: number
  minStock: number
  createdAt: Date
  updatedAt: Date
}

export interface StockMovement {
  id: string
  inventoryId: string
  type: string
  quantity: number
  reason: string
  reference?: string
  userId?: string
  createdAt: Date
}

export interface Order {
  id: string
  tenantId: string
  orderNumber: string
  source: string
  sourceChannel: string
  externalOrderId?: string
  customerName: string
  customerEmail?: string
  customerPhone?: string
  shippingAddress?: Address
  billingAddress?: Address
  subtotal: number
  shippingCost: number
  tax: number
  discount: number
  total: number
  currency: string
  status: string
  paymentStatus: string
  shipmentStatus: string
  notes?: string
  items: OrderItem[]
  createdAt: Date
  updatedAt: Date
}

export interface OrderItem {
  id: string
  orderId: string
  productId?: string
  variantId?: string
  sku: string
  name: string
  quantity: number
  unitPrice: number
  totalPrice: number
}

export interface Address {
  name: string
  company?: string
  address1: string
  address2?: string
  city: string
  state?: string
  zipCode: string
  country: string
  phone?: string
}

export interface Connection {
  id: string
  tenantId: string
  type: string
  provider: string
  name: string
  config?: Record<string, unknown>
  status: string
  lastSync?: Date
  lastError?: string
  syncEnabled: boolean
  createdAt: Date
  updatedAt: Date
}

export interface MarketplaceMapping {
  id: string
  productId: string
  connectionId: string
  marketplaceProductId?: string
  marketplaceSku?: string
  marketplaceCategoryId?: string
  marketplacePrice?: number
  syncStatus: string
  lastSyncAt?: Date
  errorMessage?: string
}

export interface Warehouse {
  id: string
  tenantId: string
  name: string
  address?: Address
  type: string
  active: boolean
  createdAt: Date
  updatedAt: Date
}
