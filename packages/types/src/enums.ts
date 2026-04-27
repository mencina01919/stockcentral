export enum UserRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  MANAGER = 'manager',
  STAFF = 'staff',
  READONLY = 'readonly',
}

export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
}

export enum TenantStatus {
  TRIAL = 'trial',
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  CANCELLED = 'cancelled',
}

export enum TenantPlan {
  FREE = 'free',
  STARTER = 'starter',
  PRO = 'pro',
  BUSINESS = 'business',
  ENTERPRISE = 'enterprise',
}

export enum ProductStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  ARCHIVED = 'archived',
}

export enum OrderStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  PROCESSING = 'processing',
  FULFILLED = 'fulfilled',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
}

export enum PaymentStatus {
  PENDING = 'pending',
  PAID = 'paid',
  PARTIALLY_PAID = 'partially_paid',
  REFUNDED = 'refunded',
  FAILED = 'failed',
}

export enum ShipmentStatus {
  PENDING = 'pending',
  READY = 'ready',
  SHIPPED = 'shipped',
  DELIVERED = 'delivered',
  RETURNED = 'returned',
}

export enum ConnectionType {
  ECOMMERCE = 'ecommerce',
  MARKETPLACE = 'marketplace',
  SHIPPING = 'shipping',
  ERP = 'erp',
}

export enum ConnectionProvider {
  SHOPIFY = 'shopify',
  WOOCOMMERCE = 'woocommerce',
  JUMPSELLER = 'jumpseller',
  PRESTASHOP = 'prestashop',
  MERCADOLIBRE = 'mercadolibre',
  FALABELLA = 'falabella',
  WALMART = 'walmart',
  RIPLEY = 'ripley',
  PARIS = 'paris',
  CUSTOM = 'custom',
}

export enum ConnectionStatus {
  CONNECTED = 'connected',
  DISCONNECTED = 'disconnected',
  ERROR = 'error',
  SYNCING = 'syncing',
}

export enum StockMovementType {
  IN = 'in',
  OUT = 'out',
  ADJUSTMENT = 'adjustment',
  TRANSFER = 'transfer',
  RESERVATION = 'reservation',
  RELEASE = 'release',
}

export enum SyncStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  ERROR = 'error',
  PARTIAL = 'partial',
}
