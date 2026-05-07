export const BILLING_QUEUE = 'billing'

export const BillingJobType = {
  EMIT_DOCUMENT: 'billing:emit-document',
  EMIT_CREDIT_NOTE: 'billing:emit-credit-note',
} as const
export type BillingJobType = (typeof BillingJobType)[keyof typeof BillingJobType]

// Si la sale viene marcada para factura pero faltan datos de billing, esperamos
// hasta este tiempo total antes de degradar a boleta.
export const FACTURA_WAIT_MS = 24 * 60 * 60 * 1000

// Backoff para reintentos del job: empieza en 1h y duplica.
export const RETRY_BACKOFF_MS = 60 * 60 * 1000

// Tope de reintentos antes de marcar el documento como failed permanente.
export const MAX_RETRY_ATTEMPTS = 5
