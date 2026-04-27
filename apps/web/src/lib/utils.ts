import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number, currency = 'CLP', locale = 'es-CL') {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
  }).format(amount)
}

export function formatDate(date: Date | string, locale = 'es-CL') {
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date))
}

export function formatRelativeDate(date: Date | string) {
  const now = new Date()
  const d = new Date(date)
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000)

  if (diff < 60) return 'hace un momento'
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`
  return `hace ${Math.floor(diff / 86400)} días`
}

export const ORDER_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pendiente', color: 'bg-yellow-100 text-yellow-800' },
  confirmed: { label: 'Confirmada', color: 'bg-blue-100 text-blue-800' },
  processing: { label: 'En proceso', color: 'bg-purple-100 text-purple-800' },
  fulfilled: { label: 'Despachada', color: 'bg-indigo-100 text-indigo-800' },
  completed: { label: 'Completada', color: 'bg-green-100 text-green-800' },
  cancelled: { label: 'Cancelada', color: 'bg-red-100 text-red-800' },
}

export const CONNECTION_STATUS_LABELS: Record<string, { label: string; color: string; dot: string }> = {
  connected: { label: 'Conectado', color: 'text-green-600', dot: 'bg-green-500' },
  syncing: { label: 'Sincronizando', color: 'text-blue-600', dot: 'bg-blue-500' },
  error: { label: 'Error', color: 'text-red-600', dot: 'bg-red-500' },
  disconnected: { label: 'Desconectado', color: 'text-gray-400', dot: 'bg-gray-400' },
}

export const PROVIDER_LABELS: Record<string, string> = {
  shopify: 'Shopify',
  woocommerce: 'WooCommerce',
  jumpseller: 'Jumpseller',
  prestashop: 'PrestaShop',
  mercadolibre: 'Mercado Libre',
  falabella: 'Falabella',
  walmart: 'Walmart',
  ripley: 'Ripley',
  paris: 'Paris',
  custom: 'Personalizado',
}
