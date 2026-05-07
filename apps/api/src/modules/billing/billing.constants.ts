export const BILLING_QUEUE = 'billing'

export const BillingJobType = {
  EMIT_DOCUMENT: 'billing:emit-document',
  EMIT_CREDIT_NOTE: 'billing:emit-credit-note',
  // Sube el PDF del DTE emitido al marketplace (hoy solo ML soporta esto).
  // Se encola desde el listener cuando un TaxDocument pasa a `issued` y la
  // conexión Bsale tiene `pushToMarketplace: true`.
  PUSH_TO_MARKETPLACE: 'billing:push-to-marketplace',
  // Emisión manual disparada por el operador (1 doc o bulk). NO espera 24h
  // por datos de factura ni respeta autoEmit. Procesa secuencial con throttle
  // para no saturar Bsale.
  EMIT_NOW: 'billing:emit-now',
} as const
export type BillingJobType = (typeof BillingJobType)[keyof typeof BillingJobType]

// Throttle entre emisiones secuenciales en bulk. Bsale tiene rate limits y
// 1 req/sec es seguro y suficientemente rápido para 100 ventas en ~2 min.
export const BULK_EMIT_THROTTLE_MS = 1000

// Si la sale viene marcada para factura pero faltan datos de billing, esperamos
// hasta este tiempo total antes de degradar a boleta.
export const FACTURA_WAIT_MS = 24 * 60 * 60 * 1000

// Backoff para reintentos del job: empieza en 1h y duplica.
export const RETRY_BACKOFF_MS = 60 * 60 * 1000

// Tope de reintentos antes de marcar el documento como failed permanente.
export const MAX_RETRY_ATTEMPTS = 5
