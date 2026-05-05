'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, RefreshCw, CheckCircle2, AlertCircle, TrendingUp, Link2, X } from 'lucide-react'
import { toast } from 'sonner'
import api from '@/lib/api'
import { cn, PROVIDER_LABELS } from '@/lib/utils'

const CONFIDENCE_INFO: Record<string, { label: string; color: string; bar: string }> = {
  high:   { label: 'Alta',  color: 'text-green-700 bg-green-100',  bar: 'bg-green-500' },
  medium: { label: 'Media', color: 'text-yellow-700 bg-yellow-100', bar: 'bg-yellow-400' },
  low:    { label: 'Baja',  color: 'text-gray-600 bg-gray-100',    bar: 'bg-gray-300' },
}

export default function StockSyncPage() {
  const qc = useQueryClient()
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>('')
  const [filter, setFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all')

  const { data: connections = [] } = useQuery<any[]>({
    queryKey: ['connections-marketplace'],
    queryFn: () => api.get('/connections').then(r => r.data.filter((c: any) => c.type === 'marketplace' && c.status === 'connected')),
  })

  const { data: recommendations = [], isLoading, refetch } = useQuery<any[]>({
    queryKey: ['sync-recommendations', selectedConnectionId],
    queryFn: () => api.get(`/stock-sync/recommendations/${selectedConnectionId}`).then(r => r.data),
    enabled: !!selectedConnectionId,
  })

  const applyMutation = useMutation({
    mutationFn: (data: any) => api.post(`/stock-sync/apply/${selectedConnectionId}`, data),
    onSuccess: () => { toast.success('Sincronización aplicada'); refetch() },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error al sincronizar'),
  })

  const syncAllMutation = useMutation({
    mutationFn: () => api.post(`/stock-sync/sync-all/${selectedConnectionId}`),
    onSuccess: (r: any) => {
      const d = r.data
      toast.success(`${d.synced} sincronizados${d.errors > 0 ? `, ${d.errors} errores` : ''}`)
      refetch()
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error en sincronización masiva'),
  })

  const filtered = recommendations.filter(r =>
    filter === 'all' || r.match.confidence === filter
  )

  const counts = {
    high:   recommendations.filter(r => r.match.confidence === 'high').length,
    medium: recommendations.filter(r => r.match.confidence === 'medium').length,
    low:    recommendations.filter(r => r.match.confidence === 'low').length,
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sync de Stock</h1>
          <p className="text-sm text-gray-500 mt-1">Recomendaciones para vincular y sincronizar el stock maestro con tus marketplaces</p>
        </div>
        {selectedConnectionId && (
          <button onClick={() => syncAllMutation.mutate()} disabled={syncAllMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-sky-600 text-white rounded-xl text-sm font-medium hover:bg-sky-700 disabled:opacity-50">
            {syncAllMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Sincronizar todos los vinculados
          </button>
        )}
      </div>

      {/* Selector de marketplace */}
      <div className="bg-white border rounded-xl p-4">
        <label className="text-sm font-medium text-gray-700">Marketplace a analizar</label>
        <select value={selectedConnectionId} onChange={e => setSelectedConnectionId(e.target.value)}
          className="mt-2 w-full max-w-sm px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
          <option value="">Seleccionar marketplace...</option>
          {connections.map((c: any) => (
            <option key={c.id} value={c.id}>{c.name} ({PROVIDER_LABELS[c.provider] || c.provider})</option>
          ))}
        </select>
      </div>

      {selectedConnectionId && (
        <>
          {/* Resumen de confianza */}
          {!isLoading && recommendations.length > 0 && (
            <div className="grid grid-cols-3 gap-4">
              {(['high', 'medium', 'low'] as const).map(conf => {
                const info = CONFIDENCE_INFO[conf]
                return (
                  <button key={conf} onClick={() => setFilter(filter === conf ? 'all' : conf)}
                    className={cn('bg-white border rounded-xl p-4 text-left transition-all',
                      filter === conf && 'ring-2 ring-sky-500')}>
                    <p className={cn('text-xs font-medium px-2 py-0.5 rounded-full inline-block', info.color)}>{info.label} confianza</p>
                    <p className="text-2xl font-bold text-gray-900 mt-2">{counts[conf]}</p>
                    <p className="text-xs text-gray-400">coincidencias</p>
                  </button>
                )
              })}
            </div>
          )}

          {/* Lista de recomendaciones */}
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-white border rounded-xl flex items-center justify-center py-20">
              <div className="text-center">
                <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-3" />
                <p className="text-gray-500 text-sm">No hay recomendaciones pendientes</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((rec: any, i: number) => {
                const conf = CONFIDENCE_INFO[rec.match.confidence]
                return (
                  <div key={i} className={cn('bg-white border rounded-xl p-5', rec.existingMapping && 'border-green-200 bg-green-50/30')}>
                    <div className="flex items-start gap-4">
                      {/* Score */}
                      <div className="flex-shrink-0 text-center w-16">
                        <div className="text-2xl font-bold text-gray-900">{rec.match.score}</div>
                        <div className="text-xs text-gray-400">/ 100</div>
                        <div className="mt-1.5 h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                          <div className={cn('h-full rounded-full', conf.bar)} style={{ width: `${rec.match.score}%` }} />
                        </div>
                        <span className={cn('text-xs px-1.5 py-0.5 rounded-full font-medium mt-1 inline-block', conf.color)}>
                          {conf.label}
                        </span>
                      </div>

                      {/* Productos */}
                      <div className="flex-1 grid grid-cols-2 gap-4">
                        <div className="bg-sky-50 border border-sky-100 rounded-xl p-3">
                          <p className="text-xs font-semibold text-sky-600 mb-1">STOCK MAESTRO</p>
                          <p className="text-sm font-medium text-gray-900 truncate">{rec.masterProduct.name}</p>
                          <p className="text-xs text-gray-500">SKU: {rec.masterProduct.sku}</p>
                          <p className="text-xs text-gray-500 mt-1">Stock online: <span className="font-semibold text-gray-900">{rec.masterProduct.stock}</span></p>
                        </div>
                        <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                          <p className="text-xs font-semibold text-gray-500 mb-1">{PROVIDER_LABELS[rec.provider]?.toUpperCase() || rec.provider.toUpperCase()}</p>
                          <p className="text-sm font-medium text-gray-900 truncate">{rec.marketProduct.title}</p>
                          <p className="text-xs text-gray-500">SKU: {rec.marketProduct.externalSku || '—'}</p>
                          <p className="text-xs text-gray-500 mt-1">Stock market: <span className="font-semibold text-gray-900">{rec.marketProduct.stock}</span></p>
                          {rec.marketProduct.url && (
                            <a href={rec.marketProduct.url} target="_blank" rel="noopener noreferrer"
                              className="text-xs text-sky-600 hover:underline mt-1 block truncate">Ver publicación</a>
                          )}
                        </div>
                      </div>

                      {/* Acciones */}
                      <div className="flex-shrink-0 flex flex-col gap-2">
                        {rec.existingMapping ? (
                          <div className="flex items-center gap-1 text-green-600 text-xs font-medium">
                            <CheckCircle2 className="w-4 h-4" /> Vinculado
                          </div>
                        ) : (
                          <button
                            onClick={() => applyMutation.mutate({
                              productId: rec.masterProduct.id,
                              marketplaceProductId: rec.marketProduct.externalId,
                              marketplaceSku: rec.marketProduct.externalSku,
                            })}
                            disabled={applyMutation.isPending}
                            className="flex items-center gap-1.5 px-3 py-2 bg-sky-600 text-white rounded-xl text-xs font-medium hover:bg-sky-700 disabled:opacity-50">
                            <Link2 className="w-3.5 h-3.5" /> Vincular y sincronizar
                          </button>
                        )}
                        {/* Indicadores de match */}
                        <div className="text-xs text-gray-400 space-y-0.5">
                          {rec.match.skuExact && <p className="text-green-600">✓ SKU exacto</p>}
                          {rec.match.skuPartial && !rec.match.skuExact && <p className="text-yellow-600">~ SKU parcial</p>}
                          <p>Nombre: {Math.round(rec.match.nameSimilarity * 100)}%</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
