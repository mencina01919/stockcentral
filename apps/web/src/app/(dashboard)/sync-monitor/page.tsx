'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, AlertTriangle, CheckCircle2, Clock, Loader2, RefreshCw, XCircle } from 'lucide-react'
import api from '@/lib/api'
import { Header } from '@/components/layout/header'
import { Panel, MonoLabel, Chip, StatTile } from '@/components/sc/ui'
import { cn, PROVIDER_LABELS } from '@/lib/utils'

type CronRun = {
  id: string
  cron: string
  provider: string | null
  connectionId: string | null
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  status: 'running' | 'success' | 'error'
  stats: any
  errorMessage: string | null
}

type CronStat = {
  cron: string
  provider: string | null
  total: number
  success: number
  error: number
  avgMs: number
  lastAt: string | null
}

type Health = {
  ok: boolean
  alerts: {
    connectionId: string
    provider: string
    name: string
    lastSuccessAt: string | null
    minutesSinceLastSuccess: number | null
    reason: string
  }[]
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms} ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'nunca'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return `hace ${Math.floor(diff / 1000)}s`
  if (diff < 3_600_000) return `hace ${Math.floor(diff / 60_000)} min`
  if (diff < 86_400_000) return `hace ${Math.floor(diff / 3_600_000)}h`
  return `hace ${Math.floor(diff / 86_400_000)}d`
}

function formatLocal(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-CL', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

export default function SyncMonitorPage() {
  const [providerFilter, setProviderFilter] = useState<string>('')

  const { data: runs = [], isLoading: loadingRuns, refetch: refetchRuns } = useQuery<CronRun[]>({
    queryKey: ['cron-runs'],
    queryFn: () => api.get('/sync/cron-runs?limit=100').then((r) => r.data),
    refetchInterval: 30_000,  // refresca cada 30s
  })

  const { data: stats = [] } = useQuery<CronStat[]>({
    queryKey: ['cron-stats'],
    queryFn: () => api.get('/sync/cron-stats?hours=24').then((r) => r.data),
    refetchInterval: 60_000,
  })

  const { data: health } = useQuery<Health>({
    queryKey: ['cron-health'],
    queryFn: () => api.get('/sync/cron-health').then((r) => r.data),
    refetchInterval: 30_000,
  })

  const filteredRuns = providerFilter
    ? runs.filter((r) => r.provider === providerFilter)
    : runs

  const providers = Array.from(new Set(runs.map((r) => r.provider).filter(Boolean))) as string[]

  // Stat tiles
  const totalRuns24h = stats.reduce((s, x) => s + x.total, 0)
  const successRuns24h = stats.reduce((s, x) => s + x.success, 0)
  const errorRuns24h = stats.reduce((s, x) => s + x.error, 0)
  const avgMs = stats.length ? Math.round(stats.reduce((s, x) => s + x.avgMs, 0) / stats.length) : 0

  return (
    <div>
      <Header
        title="Monitor de Sync"
        subtitle="Ejecuciones de crons y alertas de inactividad"
        actions={
          <button
            onClick={() => refetchRuns()}
            className="sc-btn-secondary inline-flex items-center gap-2"
          >
            <RefreshCw className={cn('w-4 h-4', loadingRuns && 'animate-spin')} />
            Refrescar
          </button>
        }
      />

      <div className="p-6 space-y-6">
        {/* Banner alerta */}
        {health && !health.ok && health.alerts.length > 0 && (
          <div className="bg-red-50 border-2 border-red-300 rounded-lg p-4 flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-red-900">
                {health.alerts.length} {health.alerts.length === 1 ? 'cron sin actividad reciente' : 'crons sin actividad reciente'}
              </h3>
              <ul className="mt-2 space-y-1 text-sm text-red-800">
                {health.alerts.map((a) => (
                  <li key={a.connectionId}>
                    <strong>{a.name}</strong> ({PROVIDER_LABELS[a.provider] || a.provider}): {a.reason}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {health && health.ok && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2 text-sm text-green-900">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            Todos los crons de catalog source están corriendo dentro de los umbrales.
          </div>
        )}

        {/* Stat tiles */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatTile label="Runs 24h" value={totalRuns24h.toLocaleString()} />
          <StatTile label="Éxitos 24h" value={successRuns24h.toLocaleString()} accent="text-green-600" />
          <StatTile label="Errores 24h" value={errorRuns24h.toLocaleString()} accent={errorRuns24h > 0 ? 'text-red-600' : undefined} />
          <StatTile label="Duración promedio" value={formatDuration(avgMs)} />
        </div>

        {/* Stats por cron */}
        {stats.length > 0 && (
          <Panel>
            <div className="px-3 py-2 border-b border-gray-100 text-sm font-semibold">Resumen por cron (últimas 24h)</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-gray-500 border-b">
                  <tr>
                    <th className="text-left py-2 px-3">Cron</th>
                    <th className="text-left py-2 px-3">Provider</th>
                    <th className="text-right py-2 px-3">Total</th>
                    <th className="text-right py-2 px-3">Éxitos</th>
                    <th className="text-right py-2 px-3">Errores</th>
                    <th className="text-right py-2 px-3">Duración promedio</th>
                    <th className="text-right py-2 px-3">Último run</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((s, i) => (
                    <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 px-3 font-mono text-xs">{s.cron}</td>
                      <td className="py-2 px-3">{s.provider ? (PROVIDER_LABELS[s.provider] || s.provider) : '—'}</td>
                      <td className="py-2 px-3 text-right">{s.total}</td>
                      <td className="py-2 px-3 text-right text-green-700">{s.success}</td>
                      <td className={cn('py-2 px-3 text-right', s.error > 0 && 'text-red-700 font-medium')}>{s.error}</td>
                      <td className="py-2 px-3 text-right">{formatDuration(s.avgMs)}</td>
                      <td className="py-2 px-3 text-right text-gray-500">{formatRelative(s.lastAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        {/* Filtro */}
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-600">Provider:</label>
          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className="sc-input text-sm"
          >
            <option value="">Todos</option>
            {providers.map((p) => (
              <option key={p} value={p}>{PROVIDER_LABELS[p] || p}</option>
            ))}
          </select>
        </div>

        {/* Tabla de runs */}
        <Panel>
          <div className="px-3 py-2 border-b border-gray-100 text-sm font-semibold">Últimos {filteredRuns.length} runs</div>
          {loadingRuns ? (
            <div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin inline" /></div>
          ) : filteredRuns.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-sm">Sin runs registrados todavía</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-gray-500 border-b">
                  <tr>
                    <th className="text-left py-2 px-3">Estado</th>
                    <th className="text-left py-2 px-3">Cron</th>
                    <th className="text-left py-2 px-3">Provider</th>
                    <th className="text-left py-2 px-3">Inicio</th>
                    <th className="text-right py-2 px-3">Duración</th>
                    <th className="text-left py-2 px-3">Stats / Error</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRuns.map((r) => (
                    <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 px-3">
                        {r.status === 'success' && <CheckCircle2 className="w-4 h-4 text-green-600" />}
                        {r.status === 'error' && <XCircle className="w-4 h-4 text-red-600" />}
                        {r.status === 'running' && <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />}
                      </td>
                      <td className="py-2 px-3 font-mono text-xs">{r.cron}</td>
                      <td className="py-2 px-3">{r.provider ? (PROVIDER_LABELS[r.provider] || r.provider) : '—'}</td>
                      <td className="py-2 px-3 text-gray-600">
                        <div>{formatLocal(r.startedAt)}</div>
                        <div className="text-xs text-gray-400">{formatRelative(r.startedAt)}</div>
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-xs">{formatDuration(r.durationMs)}</td>
                      <td className="py-2 px-3 text-xs">
                        {r.errorMessage && <div className="text-red-700">{r.errorMessage}</div>}
                        {r.stats && (
                          <div className="text-gray-600">
                            {typeof r.stats === 'object' && r.stats !== null && (
                              <>
                                {r.stats.scanned !== undefined && <span className="mr-3">scanned: <strong>{r.stats.scanned}</strong></span>}
                                {r.stats.created !== undefined && <span className="mr-3">created: <strong>{r.stats.created}</strong></span>}
                                {r.stats.updated !== undefined && <span className="mr-3">updated: <strong>{r.stats.updated}</strong></span>}
                                {r.stats.unchanged !== undefined && <span className="mr-3">unchanged: <strong>{r.stats.unchanged}</strong></span>}
                                {r.stats.errors !== undefined && <span className={cn('mr-3', r.stats.errors > 0 && 'text-red-600 font-semibold')}>errors: <strong>{r.stats.errors}</strong></span>}
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
