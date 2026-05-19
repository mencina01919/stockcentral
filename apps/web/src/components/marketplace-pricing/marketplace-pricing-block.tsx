'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import api from '@/lib/api'
import { formatCurrency } from '@/lib/utils'

// Defaults por marketplace — se usan cuando no hay configuración guardada.
// commission/shipping son los típicos de cada Chile market.
export const MARKETPLACE_DEFAULTS: Record<string, { label: string; commission: number; shipping: number; color: string }> = {
  lider:         { label: 'Lider',          commission: 12, shipping: 3500,  color: 'bg-blue-600' },
  mercadolibre:  { label: 'MercadoLibre',   commission: 13, shipping: 2990,  color: 'bg-yellow-400' },
  paris:         { label: 'Paris',          commission: 15, shipping: 3500,  color: 'bg-red-700' },
  falabella:     { label: 'Falabella',      commission: 15, shipping: 3500,  color: 'bg-green-700' },
  shopify:       { label: 'Shopify',        commission: 2,  shipping: 0,     color: 'bg-green-600' },
  woocommerce:   { label: 'WooCommerce',    commission: 0,  shipping: 0,     color: 'bg-purple-600' },
  jumpseller:    { label: 'Jumpseller',     commission: 2,  shipping: 0,     color: 'bg-orange-500' },
}

// Calcula el precio de venta para marketplace. Redondeo psicológico
// chileno: SIEMPRE termina en 990 (ej. 259.990, 1.601.990).
// Estrategia: tomamos el techo a múltiplo de 1000 y restamos 10. Si el
// valor crudo ya está debajo de XX.990 (ej. 259.500), redondeamos hacia
// arriba a 259.990; nunca bajamos para no comer margen.
// Edge: si raw < 1000 (cost 0 o negativo), devolvemos 990 mínimo.
export function calcPrice(cost: number, commission: number, shipping: number, margin: number): number {
  if (commission + margin >= 100) return 0
  const raw = (cost + shipping) / (1 - (commission + margin) / 100)
  if (raw <= 0) return 0
  const result = Math.ceil(raw / 1000) * 1000 - 10
  return result < 990 ? 990 : result
}

// Calculadora de precios por marketplace.
// - product: el producto del catálogo maestro (debe tener id + costPrice).
// - filterProviders: si se pasa, solo muestra esos providers. Ej en
//   publicaciones ML solo se muestra 'mercadolibre'.
export function MarketplacePricingBlock({
  product,
  filterProviders,
  compact = false,
  onCalculatedPriceChange,
}: {
  product: any
  filterProviders?: string[]
  compact?: boolean
  // Callback opcional: cuando el precio calculado cambia (porque cambió
  // alguno de los inputs commission/shipping/margin/cost), lo notifica al
  // padre. PublishForm lo usa para sincronizar formData.price en vivo.
  // Se dispara para CADA provider visible si tiene enabled=true.
  onCalculatedPriceChange?: (provider: string, calculatedPrice: number) => void
}) {
  const queryClient = useQueryClient()
  const cost = Number(product.costPrice ?? 0)
  const basePrice = Number(product.basePrice ?? 0)

  const { data: savedPricing } = useQuery<any>({
    queryKey: ['marketplace-pricing', product.id],
    queryFn: () => api.get(`/products/${product.id}/marketplace-pricing`).then(r => r.data),
  })

  const { data: connections = [] } = useQuery<any[]>({
    queryKey: ['connections-marketplace'],
    queryFn: () => api.get('/connections').then(r =>
      r.data.filter((c: any) =>
        c.status === 'connected' &&
        (c.type === 'marketplace' || c.type === 'ecommerce') &&
        !c.isCatalogSource
      )
    ),
  })

  const visibleConnections = filterProviders?.length
    ? connections.filter((c: any) => filterProviders.includes(c.provider))
    : connections

  const [pricing, setPricing] = useState<Record<string, { commission: number; shipping: number; margin: number; enabled: boolean }>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!savedPricing || !connections.length) return
    const saved = savedPricing.pricing || {}
    const init: typeof pricing = {}
    for (const conn of connections) {
      const def = MARKETPLACE_DEFAULTS[conn.provider] || { commission: 12, shipping: 3500 }
      const s = saved[conn.provider] || {}
      init[conn.provider] = {
        commission: s.commission ?? def.commission,
        shipping:   s.shipping   ?? def.shipping,
        margin:     s.margin     ?? 10,
        enabled:    s.enabled    ?? true,
      }
    }
    setPricing(init)
  }, [savedPricing, connections])

  // Notificar precio calculado al padre cada vez que cambian los inputs.
  // Para que el campo "price" de la publicación se sincronice con la
  // calculadora sin que el usuario tenga que clickear "Guardar".
  // Trackeo el último valor enviado por provider para no spamear con
  // el mismo cálculo en re-renders.
  const lastNotifiedRef = useRef<Record<string, number>>({})
  useEffect(() => {
    if (!onCalculatedPriceChange) return
    for (const conn of visibleConnections) {
      const p = pricing[conn.provider]
      if (!p || !p.enabled) continue
      const calculated = calcPrice(cost, p.commission, p.shipping, p.margin)
      if (lastNotifiedRef.current[conn.provider] !== calculated) {
        lastNotifiedRef.current[conn.provider] = calculated
        onCalculatedPriceChange(conn.provider, calculated)
      }
    }
  }, [pricing, cost, visibleConnections, onCalculatedPriceChange])

  // Autosave con debounce: cualquier cambio en commission/shipping/margin/enabled
  // se persiste en Product.marketplacePricing[provider] después de 1s sin tocar.
  // Sin esto, si el usuario publica antes de hacer clic en "Guardar", el backend
  // no encuentra calculatedPrice y publica con basePrice (precio equivocado).
  const lastSavedSerializedRef = useRef<string>('')
  useEffect(() => {
    if (!Object.keys(pricing).length || !connections.length) return
    if (!product?.id) return
    const payload: Record<string, any> = {}
    for (const conn of connections) {
      const p = pricing[conn.provider]
      if (!p || !p.enabled) continue
      payload[conn.provider] = {
        ...p,
        calculatedPrice: calcPrice(cost, p.commission, p.shipping, p.margin),
      }
    }
    const serialized = JSON.stringify(payload)
    if (serialized === lastSavedSerializedRef.current) return

    const handle = setTimeout(() => {
      lastSavedSerializedRef.current = serialized
      api.patch(`/products/${product.id}/marketplace-pricing`, payload)
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['marketplace-pricing', product.id] })
        })
        .catch(() => { /* fallback al botón manual "Guardar precios" */ })
    }, 1000)
    return () => clearTimeout(handle)
  }, [pricing, cost, connections, product?.id, queryClient])

  const set = (provider: string, key: string, val: number | boolean) =>
    setPricing(p => ({ ...p, [provider]: { ...p[provider], [key]: val } }))

  const save = async () => {
    setSaving(true)
    try {
      const payload: Record<string, any> = {}
      for (const conn of connections) {
        const p = pricing[conn.provider]
        if (!p || !p.enabled) continue
        const calculated = calcPrice(cost, p.commission, p.shipping, p.margin)
        payload[conn.provider] = { ...p, calculatedPrice: calculated }
      }
      await api.patch(`/products/${product.id}/marketplace-pricing`, payload)
      queryClient.invalidateQueries({ queryKey: ['marketplace-pricing', product.id] })
      toast.success('Precios por marketplace guardados')
    } catch {
      toast.error('Error al guardar precios')
    } finally {
      setSaving(false)
    }
  }

  if (!visibleConnections.length) return null

  if (!cost) {
    return (
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Calculadora de precios por marketplace
        </p>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
          <p className="font-medium">Falta el precio de costo</p>
          <p className="text-xs mt-1 text-amber-700">
            Para calcular precios por marketplace, primero ingresa el costo del producto en el catálogo maestro.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div>
      {!compact && (
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Calculadora de precios por marketplace
        </p>
      )}
      <p className="text-xs text-gray-400 mb-3">
        Costo base: <span className="font-semibold text-gray-700">{formatCurrency(cost)}</span>
        {basePrice > 0 && <span className="ml-3">· Precio venta directa: <span className="font-semibold text-gray-700">{formatCurrency(basePrice)}</span></span>}
      </p>
      <div className="space-y-3">
        {visibleConnections.map((conn: any) => {
          const def = MARKETPLACE_DEFAULTS[conn.provider]
          const p = pricing[conn.provider]
          if (!p) return null
          const calculated = calcPrice(cost, p.commission, p.shipping, p.margin)
          const gain = calculated - cost - p.shipping
          const gainPct = cost > 0 ? ((gain / cost) * 100).toFixed(1) : '0'

          return (
            <div key={conn.provider} className={`border rounded-xl overflow-hidden ${p.enabled ? 'border-gray-200' : 'border-gray-100 opacity-50'}`}>
              <div className="flex items-center justify-between px-3 py-2 bg-gray-50">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${def?.color || 'bg-gray-400'}`} />
                  <span className="text-sm font-medium text-gray-800">{def?.label || conn.provider}</span>
                </div>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={p.enabled} onChange={e => set(conn.provider, 'enabled', e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-sky-600 focus:ring-sky-500" />
                  <span className="text-xs text-gray-500">Activo</span>
                </label>
              </div>

              {p.enabled && (
                <div className="px-3 py-3 space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Comisión %</label>
                      <input type="number" min="0" max="50" step="0.5"
                        value={p.commission}
                        onChange={e => set(conn.provider, 'commission', Number(e.target.value))}
                        className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-sky-500 text-center" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Despacho $</label>
                      <input type="number" min="0" step="100"
                        value={p.shipping}
                        onChange={e => set(conn.provider, 'shipping', Number(e.target.value))}
                        className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-sky-500 text-center" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Margen %</label>
                      <input type="number" min="0" max="80" step="1"
                        value={p.margin}
                        onChange={e => set(conn.provider, 'margin', Number(e.target.value))}
                        className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-sky-500 text-center" />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-gray-100">
                    <div>
                      <p className="text-xs text-gray-400">Precio sugerido</p>
                      <p className="text-base font-bold text-sky-700">{formatCurrency(calculated)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-400">Ganancia estimada</p>
                      <p className={`text-sm font-semibold ${gain > 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {formatCurrency(gain)} ({gainPct}%)
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <button
        onClick={save}
        disabled={saving}
        className="mt-3 w-full px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
        Guardar precios
      </button>
    </div>
  )
}
