'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, RefreshCw, CheckCircle2, Link2 } from 'lucide-react'
import { toast } from 'sonner'
import api from '@/lib/api'
import { Header } from '@/components/layout/header'
import { Panel, MonoLabel, Chip, ProgressBar, StatTile } from '@/components/sc/ui'
import { cn, PROVIDER_LABELS } from '@/lib/utils'

const CONFIDENCE_INFO: Record<string, { label: string; tone: 'ok' | 'warn' | 'low'; barTone: 'ok' | 'warn' | 'blue' }> = {
  high: { label: 'ALTA', tone: 'ok', barTone: 'ok' },
  medium: { label: 'MEDIA', tone: 'warn', barTone: 'warn' },
  low: { label: 'BAJA', tone: 'low', barTone: 'blue' },
}

export default function StockSyncPage() {
  const qc = useQueryClient()
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>('')
  const [filter, setFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all')

  const { data: connections = [] } = useQuery<any[]>({
    queryKey: ['connections-marketplace'],
    queryFn: () =>
      api.get('/connections').then((r) =>
        r.data.filter((c: any) => c.type === 'marketplace' && c.status === 'connected'),
      ),
  })

  const { data: recommendations = [], isLoading, refetch } = useQuery<any[]>({
    queryKey: ['sync-recommendations', selectedConnectionId],
    queryFn: () =>
      api.get(`/stock-sync/recommendations/${selectedConnectionId}`).then((r) => r.data),
    enabled: !!selectedConnectionId,
  })

  const applyMutation = useMutation({
    mutationFn: (data: any) =>
      api.post(`/stock-sync/apply/${selectedConnectionId}`, data),
    onSuccess: () => {
      toast.success('Sincronización aplicada')
      refetch()
    },
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

  const filtered = recommendations.filter(
    (r) => filter === 'all' || r.match.confidence === filter,
  )

  const counts = {
    high: recommendations.filter((r) => r.match.confidence === 'high').length,
    medium: recommendations.filter((r) => r.match.confidence === 'medium').length,
    low: recommendations.filter((r) => r.match.confidence === 'low').length,
  }

  return (
    <div className="flex flex-col h-full">
      <Header
        breadcrumbs={['CONSOLA', 'SYNC DE STOCK']}
        title="Sincronización en tiempo real"
        subtitle="Recomendaciones para vincular el stock maestro con tus marketplaces"
        actions={
          selectedConnectionId ? (
            <button
              onClick={() => syncAllMutation.mutate()}
              disabled={syncAllMutation.isPending}
              className="sc-btn-primary"
              style={{ padding: '8px 14px', fontSize: 12 }}
            >
              {syncAllMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              Sincronizar todos
            </button>
          ) : null
        }
      />

      <div className="flex-1 px-7 py-6 overflow-auto space-y-5">
        {/* Live status hero */}
        <Panel className="relative overflow-hidden" style={{ padding: 24 }}>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'radial-gradient(circle at 80% 50%, rgba(59,130,246,0.10), transparent 50%)',
              pointerEvents: 'none',
            }}
          />
          <div className="relative flex items-center gap-3">
            <div className="relative" style={{ width: 12, height: 12 }}>
              <span className="sc-pulse-dot" style={{ position: 'absolute', inset: 0 }} />
            </div>
            <MonoLabel tone="ok">// SYSTEM.LIVE</MonoLabel>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--sc-text-hi)' }}>
              Motor activo
            </span>
            <Chip tone="ok" dot>EN VIVO</Chip>
          </div>
        </Panel>

        {/* Selector */}
        <Panel style={{ padding: 18 }}>
          <MonoLabel>MARKETPLACE A ANALIZAR</MonoLabel>
          <select
            value={selectedConnectionId}
            onChange={(e) => setSelectedConnectionId(e.target.value)}
            className="sc-input mt-2"
            style={{ maxWidth: 380 }}
          >
            <option value="">Seleccionar marketplace…</option>
            {connections.map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.name} ({PROVIDER_LABELS[c.provider] || c.provider})
              </option>
            ))}
          </select>
        </Panel>

        {selectedConnectionId && (
          <>
            {/* Confidence summary */}
            {!isLoading && recommendations.length > 0 && (
              <div className="grid grid-cols-3 gap-4">
                {(['high', 'medium', 'low'] as const).map((conf) => {
                  const info = CONFIDENCE_INFO[conf]
                  const isActive = filter === conf
                  return (
                    <button
                      key={conf}
                      onClick={() => setFilter(filter === conf ? 'all' : conf)}
                      className="sc-panel relative overflow-hidden text-left"
                      style={{
                        padding: 18,
                        cursor: 'pointer',
                        border: isActive
                          ? '1px solid var(--sc-blue-400)'
                          : '1px solid var(--sc-line-soft)',
                        boxShadow: isActive
                          ? '0 0 0 3px rgba(59,130,246,0.15)'
                          : undefined,
                      }}
                    >
                      <Chip tone={info.tone}>{info.label} CONFIANZA</Chip>
                      <div
                        className="sc-mono mt-3"
                        style={{
                          fontSize: 28,
                          fontWeight: 600,
                          color: 'var(--sc-text-hi)',
                          fontFeatureSettings: '"tnum"',
                          letterSpacing: '-0.02em',
                        }}
                      >
                        {counts[conf]}
                      </div>
                      <p
                        className="sc-mono"
                        style={{ fontSize: 11, color: 'var(--sc-text-low)', letterSpacing: '0.18em' }}
                      >
                        COINCIDENCIAS
                      </p>
                    </button>
                  )
                })}
              </div>
            )}

            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--sc-blue-500)' }} />
              </div>
            ) : filtered.length === 0 ? (
              <Panel className="flex items-center justify-center py-20">
                <div className="text-center">
                  <CheckCircle2
                    className="w-10 h-10 mx-auto mb-3"
                    style={{ color: 'var(--sc-ok)' }}
                  />
                  <p style={{ color: 'var(--sc-text-low)', fontSize: 13 }}>
                    No hay recomendaciones pendientes
                  </p>
                </div>
              </Panel>
            ) : (
              <div className="space-y-3">
                {filtered.map((rec: any, i: number) => {
                  const conf = CONFIDENCE_INFO[rec.match.confidence]
                  return (
                    <Panel
                      key={i}
                      style={{
                        padding: 20,
                        ...(rec.existingMapping
                          ? {
                              borderColor: 'rgba(16,185,129,0.30)',
                              background: 'rgba(16,185,129,0.03)',
                            }
                          : {}),
                      }}
                    >
                      <div className="flex items-start gap-4">
                        {/* Score */}
                        <div className="flex-shrink-0 text-center" style={{ width: 76 }}>
                          <div
                            className="sc-mono"
                            style={{
                              fontSize: 24,
                              fontWeight: 700,
                              color: 'var(--sc-text-hi)',
                              fontFeatureSettings: '"tnum"',
                            }}
                          >
                            {rec.match.score}
                          </div>
                          <div
                            className="sc-mono"
                            style={{ fontSize: 10, color: 'var(--sc-text-faint)', letterSpacing: '0.16em' }}
                          >
                            / 100
                          </div>
                          <div className="mt-2">
                            <ProgressBar value={rec.match.score} tone={conf.barTone} height={4} />
                          </div>
                          <div className="mt-2">
                            <Chip tone={conf.tone}>{conf.label}</Chip>
                          </div>
                        </div>

                        {/* Products */}
                        <div className="flex-1 grid grid-cols-2 gap-3">
                          <div
                            style={{
                              background: 'rgba(59,130,246,0.05)',
                              border: '1px solid rgba(59,130,246,0.15)',
                              borderRadius: 10,
                              padding: 14,
                            }}
                          >
                            <MonoLabel tone="blue">STOCK MAESTRO</MonoLabel>
                            <p
                              className="mt-1.5 truncate"
                              style={{ fontSize: 13, fontWeight: 500, color: 'var(--sc-text-hi)' }}
                            >
                              {rec.masterProduct.name}
                            </p>
                            <p className="sc-mono" style={{ fontSize: 11, color: 'var(--sc-text-low)', marginTop: 2 }}>
                              SKU: {rec.masterProduct.sku}
                            </p>
                            <p style={{ fontSize: 11, color: 'var(--sc-text-low)', marginTop: 4 }}>
                              Stock online:{' '}
                              <span className="sc-mono" style={{ fontWeight: 600, color: 'var(--sc-text-hi)' }}>
                                {rec.masterProduct.stock}
                              </span>
                            </p>
                          </div>
                          <div
                            style={{
                              background: '#f7f9fd',
                              border: '1px solid var(--sc-line-soft)',
                              borderRadius: 10,
                              padding: 14,
                            }}
                          >
                            <MonoLabel>{(PROVIDER_LABELS[rec.provider] || rec.provider).toUpperCase()}</MonoLabel>
                            <p
                              className="mt-1.5 truncate"
                              style={{ fontSize: 13, fontWeight: 500, color: 'var(--sc-text-hi)' }}
                            >
                              {rec.marketProduct.title}
                            </p>
                            <p className="sc-mono" style={{ fontSize: 11, color: 'var(--sc-text-low)', marginTop: 2 }}>
                              SKU: {rec.marketProduct.externalSku || '—'}
                            </p>
                            <p style={{ fontSize: 11, color: 'var(--sc-text-low)', marginTop: 4 }}>
                              Stock market:{' '}
                              <span className="sc-mono" style={{ fontWeight: 600, color: 'var(--sc-text-hi)' }}>
                                {rec.marketProduct.stock}
                              </span>
                            </p>
                            {rec.marketProduct.url && (
                              <a
                                href={rec.marketProduct.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block mt-1.5 truncate"
                                style={{ fontSize: 11, color: 'var(--sc-blue-600)' }}
                              >
                                Ver publicación →
                              </a>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex-shrink-0 flex flex-col gap-2 items-end">
                          {rec.existingMapping ? (
                            <Chip tone="ok" dot>VINCULADO</Chip>
                          ) : (
                            <button
                              onClick={() =>
                                applyMutation.mutate({
                                  productId: rec.masterProduct.id,
                                  marketplaceProductId: rec.marketProduct.externalId,
                                  marketplaceSku: rec.marketProduct.externalSku,
                                })
                              }
                              disabled={applyMutation.isPending}
                              className="sc-btn-primary"
                              style={{ padding: '7px 12px', fontSize: 11 }}
                            >
                              <Link2 className="w-3 h-3" />
                              Vincular
                            </button>
                          )}
                          <div
                            className="sc-mono text-right"
                            style={{ fontSize: 10, color: 'var(--sc-text-low)', letterSpacing: '0.08em' }}
                          >
                            {rec.match.skuExact && (
                              <p style={{ color: 'var(--sc-ok)' }}>✓ SKU EXACTO</p>
                            )}
                            {rec.match.skuPartial && !rec.match.skuExact && (
                              <p style={{ color: 'var(--sc-warn)' }}>~ SKU PARCIAL</p>
                            )}
                            <p>NOMBRE: {Math.round(rec.match.nameSimilarity * 100)}%</p>
                          </div>
                        </div>
                      </div>
                    </Panel>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
