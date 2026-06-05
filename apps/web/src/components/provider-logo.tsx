'use client'

import { useState } from 'react'
import { PROVIDER_LABELS } from '@/lib/utils'

// Maps provider id → public file path (relative to /public).
// Add a new entry here whenever you drop a logo into /public/providers/.
const PROVIDER_LOGOS: Record<string, string> = {
  mercadolibre: '/providers/mercadolibre.svg',
  falabella:    '/providers/falabella.svg',
  lider:        '/providers/lider.svg',
  paris:        '/providers/paris.svg',
  shopify:      '/providers/shopify.svg',
  woocommerce:  '/providers/woocommerce.svg',
  eylstore:     '/providers/eylstore.webp',
}

// Background tints per provider (used as fallback chip and as logo container bg).
const PROVIDER_BG: Record<string, string> = {
  mercadolibre: 'bg-yellow-50',
  falabella:    'bg-green-50',
  lider:        'bg-blue-50',
  paris:        'bg-red-50',
  shopify:      'bg-green-50',
  woocommerce:  'bg-purple-50',
  jumpseller:   'bg-blue-50',
  eylstore:     'bg-sky-50',
  wonderstore:  'bg-fuchsia-50',
  walmart:      'bg-blue-50',
  ripley:       'bg-red-50',
  prestashop:   'bg-pink-50',
  bsale:        'bg-orange-50',
  custom:       'bg-gray-100',
}

const PROVIDER_TEXT: Record<string, string> = {
  mercadolibre: 'text-yellow-700',
  falabella:    'text-green-700',
  lider:        'text-blue-700',
  paris:        'text-red-700',
  shopify:      'text-green-700',
  woocommerce:  'text-purple-700',
  jumpseller:   'text-blue-700',
  eylstore:     'text-sky-700',
  wonderstore:  'text-fuchsia-700',
  walmart:      'text-blue-700',
  ripley:       'text-red-700',
  prestashop:   'text-pink-700',
  bsale:        'text-orange-700',
  custom:       'text-gray-600',
}

const SIZE_MAP = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-11 h-11 text-sm',
  lg: 'w-14 h-14 text-base',
} as const

export function ProviderLogo({
  provider,
  size = 'md',
  variant = 'chip',
  className = '',
}: {
  provider: string
  size?: 'sm' | 'md' | 'lg'
  // 'chip' = colored rounded square. 'plain' = no background, just the logo.
  variant?: 'chip' | 'plain'
  className?: string
}) {
  const [errored, setErrored] = useState(false)
  const logo = PROVIDER_LOGOS[provider]
  const bg = PROVIDER_BG[provider] || 'bg-gray-100'
  const text = PROVIDER_TEXT[provider] || 'text-gray-600'
  const dim = SIZE_MAP[size]
  const label = PROVIDER_LABELS[provider] || provider

  const innerImg = logo && !errored ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logo}
      alt={label}
      onError={() => setErrored(true)}
      className="max-w-[80%] max-h-[80%] object-contain"
    />
  ) : (
    <span className={`font-bold ${text}`}>{label[0]?.toUpperCase()}</span>
  )

  if (variant === 'plain' && logo && !errored) {
    return (
      <div className={`${dim} flex items-center justify-center ${className}`} title={label}>
        {innerImg}
      </div>
    )
  }

  return (
    <div
      className={`${dim} ${bg} rounded-xl flex items-center justify-center overflow-hidden ${className}`}
      title={label}
    >
      {innerImg}
    </div>
  )
}
