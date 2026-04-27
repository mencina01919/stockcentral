export const SYNC_QUEUE = 'sync'

export const SyncJobType = {
  SYNC_PRODUCTS_OUTBOUND: 'sync:products:outbound',
  SYNC_ORDERS_INBOUND: 'sync:orders:inbound',
  SYNC_STOCK: 'sync:stock',
  TEST_CONNECTION: 'sync:test-connection',
  REFRESH_OAUTH_TOKEN: 'sync:refresh-oauth-token',
} as const

export type SyncJobType = (typeof SyncJobType)[keyof typeof SyncJobType]
