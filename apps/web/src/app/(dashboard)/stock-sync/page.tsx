'use client'

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, RefreshCw, CheckCircle2, Link2, CheckSquare, Square } from 'lucide-react'
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

// Key estable por fila (algunas recs no traen id propio)
const recKey = (r: any) => `${r.masterProduct?.id}::${r.marketProduct?.externalId}`

export default function StockSyncPage() {
  const qc = useQueryClient()
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>('')
  const [filter, setFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all')
  // Loading por fila — set de recKey actualmente vinculándose
  const [linkingKeys, setLinkingKeys] = useState<Set<string>>(new Set())
  // Selección múltiple
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())

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

  // Marca optimista de filas recién vinculadas — el endpoint apply tarda ~ms
  // pero refetch() recarga la query entera (que vuelve a llamar al
  // marketplace). En vez de esperar el round-trip, marcamos local y
  // refrescamos en background.
  const queryKey = ['sync-recommendations', selectedConnectionId]
  const markRecLinked = (key: string) => {
    qc.setQueryData<any[]>(queryKey, (old) => {
      if (!Array.isArray(old)) return old
      return old.map((r) => (recKey(r) === key ? { ...r, existingMapping: true } : r))
    })
  }

  // Vinculación de una sola fila — mantiene loading por recKey en el set
  const linkOne = async (rec: any): Promise<{ ok: boolean; error?: string }> => {
    const key = recKey(rec)
    setLinkingKeys((prev) => new Set(prev).add(key))
    try {
      await api.post(`/stock-sync/apply/${selectedConnectionId}`, {
        productId: rec.masterProduct.id,
        marketplaceProductId: rec.marketProduct.externalId,
        marketplaceSku: rec.marketProduct.externalSku,
      })
      // Optimistic: marca esta fila como vinculada en el cache local
      markRecLinked(key)
      return { ok: true }
    } catch (e: any) {
      return { ok: false, error: e?.response?.data?.message || 'Error' }
    } finally {
      setLinkingKeys((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  const handleLinkSingle = async (rec: any) => {
    const r = await linkOne(rec)
    if (r.ok) {
      toast.success('Vinculado')
      // No hace falta refetch — markRecLinked ya actualizó el cache.
      // Invalidamos en background para que próxima visita traiga fresh.
      qc.invalidateQueries({ queryKey, refetchType: 'none' })
    } else {
      toast.error(r.error || 'Error al vincular')
    }
  }

  // Vinculación masiva de la selección
  const [bulkRunning, setBulkRunning] = useState(false)
  const handleLinkSelected = async () => {
    const targets = recommendations.filter(
      (r) => selectedKeys.has(recKey(r)) && !r.existingMapping,
    )
    if (!targets.length) return
    setBulkRunning(true)
    let ok = 0
    let fail = 0
    for (const rec of targets) {
      const r = await linkOne(rec)
      if (r.ok) ok++
      else fail++
    }
    setBulkRunning(false)
    setSelectedKeys(new Set())
    toast.success(`${ok} vinculados${fail ? `, ${fail} con error` : ''}`)
    // markRecLinked() ya actualizó cada fila exitosa. Invalida stale sin refetch.
    qc.invalidateQueries({ queryKey, refetchType: 'none' })
  }

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

  // Solo se pueden seleccionar filas sin mapping existente
  const selectableKeys = useMemo(
    () => filtered.filter((r) => !r.existingMapping).map(recKey),
    [filtered],
  )
  const allSelected =
    selectableKeys.length > 0 && selectableKeys.every((k) => selectedKeys.has(k))
  const someSelected =
    selectableKeys.some((k) => selectedKeys.has(k)) && !allSelected

  const toggleAll = () => {
    if (allSelected) {
      setSelectedKeys(new Set())
    } else {
      setSelectedKeys(new Set(selectableKeys))
    }
  }
  const toggleOne = (key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

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
                {/* Barra de selección masiva */}
                {selectableKeys.length > 0 && (
                  <Panel
                    style={{
                      padding: 12,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      position: 'sticky',
                      top: 0,
                      zIndex: 5,
                      borderColor: selectedKeys.size
                        ? 'var(--sc-blue-400)'
                        : 'var(--sc-line-soft)',
                      boxShadow: selectedKeys.size
                        ? '0 0 0 3px rgba(59,130,246,0.10)'
                        : undefined,
                    }}
                  >
                    <button
                      onClick={toggleAll}
                      className="flex items-center gap-2"
                      style={{ fontSize: 12, color: 'var(--sc-text-hi)' }}
                      aria-label="Seleccionar todos"
                    >
                      {allSelected ? (
                        <CheckSquare className="w-4 h-4" style={{ color: 'var(--sc-blue-600)' }} />
                      ) : someSelected ? (
                        <CheckSquare className="w-4 h-4" style={{ color: 'var(--sc-blue-400)', opacity: 0.6 }} />
                      ) : (
                        <Square className="w-4 h-4" style={{ color: 'var(--sc-text-low)' }} />
                      )}
                      <span className="sc-mono" style={{ fontSize: 11, letterSpacing: '0.12em' }}>
                        {allSelected ? 'DESELECCIONAR TODOS' : 'SELECCIONAR TODOS'}
                      </span>
                    </button>
                    <span style={{ fontSize: 12, color: 'var(--sc-text-low)' }}>
                      {selectedKeys.size > 0
                        ? `${selectedKeys.size} de ${selectableKeys.length} seleccionados`
                        : `${selectableKeys.length} disponibles para vincular`}
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                      {selectedKeys.size > 0 && (
                        <button
                          onClick={() => setSelectedKeys(new Set())}
                          disabled={bulkRunning}
                          style={{
                            fontSize: 11,
                            color: 'var(--sc-text-low)',
                            padding: '6px 10px',
                          }}
                        >
                          Limpiar
                        </button>
                      )}
                      <button
                        onClick={handleLinkSelected}
                        disabled={selectedKeys.size === 0 || bulkRunning}
                        className="sc-btn-primary"
                        style={{ padding: '7px 14px', fontSize: 12 }}
                      >
                        {bulkRunning ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Vinculando ({linkingKeys.size})…
                          </>
                        ) : (
                          <>
                            <Link2 className="w-3.5 h-3.5" />
                            Vincular seleccionados
                          </>
                        )}
                      </button>
                    </div>
                  </Panel>
                )}

                {filtered.map((rec: any, i: number) => {
                  const conf = CONFIDENCE_INFO[rec.match.confidence]
                  const key = recKey(rec)
                  const isLinking = linkingKeys.has(key)
                  const isSelected = selectedKeys.has(key)
                  return (
                    <Panel
                      key={key}
                      style={{
                        padding: 20,
                        ...(rec.existingMapping
                          ? {
                              borderColor: 'rgba(16,185,129,0.30)',
                              background: 'rgba(16,185,129,0.03)',
                            }
                          : isSelected
                          ? {
                              borderColor: 'var(--sc-blue-400)',
                              background: 'rgba(59,130,246,0.04)',
                            }
                          : {}),
                      }}
                    >
                      <div className="flex items-start gap-4">
                        {/* Checkbox (solo si no está vinculado) */}
                        {!rec.existingMapping && (
                          <button
                            onClick={() => toggleOne(key)}
                            disabled={isLinking || bulkRunning}
                            className="flex-shrink-0 mt-1"
                            aria-label="Seleccionar fila"
                            style={{ padding: 2 }}
                          >
                            {isSelected ? (
                              <CheckSquare className="w-5 h-5" style={{ color: 'var(--sc-blue-600)' }} />
                            ) : (
                              <Square className="w-5 h-5" style={{ color: 'var(--sc-text-low)' }} />
                            )}
                          </button>
                        )}
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
                              onClick={() => handleLinkSingle(rec)}
                              disabled={isLinking || bulkRunning}
                              className="sc-btn-primary"
                              style={{ padding: '7px 12px', fontSize: 11, minWidth: 92 }}
                            >
                              {isLinking ? (
                                <>
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  Vinculando…
                                </>
                              ) : (
                                <>
                                  <Link2 className="w-3 h-3" />
                                  Vincular
                                </>
                              )}
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
