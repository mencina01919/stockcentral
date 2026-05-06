'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Database, Loader2, RefreshCw, CheckCircle2, AlertTriangle, Plug, Power,
  ArrowDownToLine, Box, Calendar, Settings, ArrowLeft,
} from 'lucide-react'
import api from '@/lib/api'
import { Header } from '@/components/layout/header'
import { PROVIDER_LABELS } from '@/lib/utils'
import { toast } from 'sonner'
import Link from 'next/link'

// Provider-agnostic UI for the master catalog source.
// Lists connections that COULD be a source (driver opts in), shows which one
// is active, lets the user activate/deactivate, configure auto-sync flags,
// and trigger import or stock-sync now.

interface Candidate {
  id: string
  name: string
  provider: string
  isCatalogSource: boolean
  catalogConfig: { autoSyncStock?: boolean; autoSyncProducts?: boolean; autoSyncImages?: boolean } | null
  lastCatalogSyncAt: string | null
  lastCatalogSyncStats: {
    scanned: number
    created: number
    updated: number
    unchanged: number
    errors: number
  } | null
  capabilities: {
    canBeCatalogSource: boolean
    supportsPagination: boolean
    providesStock: boolean
    providesPrices: boolean
    providesImages: boolean
    supportsSingleProductFetch: boolean
  } | null
  eligible: boolean
}

export default function CatalogSourcePage() {
  const queryClient = useQueryClient()
  const [running, setRunning] = useState<'import' | 'stock' | null>(null)

  const { data: candidates = [], isLoading } = useQuery<Candidate[]>({
    queryKey: ['catalog-source', 'candidates'],
    queryFn: () => api.get('/catalog-source/candidates').then((r) => r.data),
  })

  const active = candidates.find((c) => c.isCatalogSource) || null

  const activateMutation = useMutation({
    mutationFn: ({ id, config }: { id: string; config?: any }) =>
      api.post(`/catalog-source/${id}/activate`, config ? { catalogConfig: config } : {}),
    onSuccess: () => {
      toast.success('Fuente del catálogo activada')
      queryClient.invalidateQueries({ queryKey: ['catalog-source'] })
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'No se pudo activar'),
  })

  const deactivateMutation = useMutation({
    mutationFn: () => api.delete('/catalog-source/active'),
    onSuccess: () => {
      toast.success('Fuente del catálogo desactivada')
      queryClient.invalidateQueries({ queryKey: ['catalog-source'] })
    },
  })

  const updateConfigMutation = useMutation({
    mutationFn: (config: any) => api.patch('/catalog-source/config', config),
    onSuccess: () => {
      toast.success('Configuración actualizada')
      queryClient.invalidateQueries({ queryKey: ['catalog-source'] })
    },
  })

  const runImport = async () => {
    setRunning('import')
    try {
      const r = await api.post('/catalog-source/import', {}, { timeout: 300_000 })
      const stats = r.data
      toast.success(
        `Import OK — ${stats.created} creados, ${stats.updated} actualizados, ${stats.unchanged} sin cambios, ${stats.errors} errores`,
      )
      queryClient.invalidateQueries({ queryKey: ['catalog-source'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Falló el import')
    } finally {
      setRunning(null)
    }
  }

  const runStockSync = async () => {
    setRunning('stock')
    try {
      const r = await api.post('/catalog-source/sync-stock', {}, { timeout: 300_000 })
      const stats = r.data
      toast.success(`Stock sincronizado — ${stats.scanned} productos`)
      queryClient.invalidateQueries({ queryKey: ['catalog-source'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Falló la sincronización')
    } finally {
      setRunning(null)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Fuente del catálogo maestro"
        subtitle="Define qué conexión alimenta tu catálogo de productos"
      />

      <div className="flex-1 p-6 overflow-auto space-y-6">
        <Link
          href="/products/master"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"
        >
          <ArrowLeft className="w-4 h-4" /> Volver al catálogo
        </Link>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
          </div>
        ) : (
          <>
            {/* ── Active source card ──────────────────────────────────────── */}
            {active ? (
              <div className="bg-white border border-sky-200 rounded-xl shadow-sm">
                <div className="px-6 py-4 border-b border-sky-100 bg-sky-50 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Database className="w-5 h-5 text-sky-600" />
                    <div>
                      <p className="text-sm font-semibold text-sky-900">Fuente activa</p>
                      <p className="text-xs text-sky-700">
                        {PROVIDER_LABELS[active.provider] || active.provider} — {active.name}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (confirm('¿Quitar esta conexión como fuente del catálogo? Los productos importados seguirán existiendo.')) {
                        deactivateMutation.mutate()
                      }
                    }}
                    className="text-xs text-gray-500 hover:text-red-600 inline-flex items-center gap-1"
                  >
                    <Power className="w-3 h-3" /> Desactivar
                  </button>
                </div>

                <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Last run */}
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Última corrida</p>
                    {active.lastCatalogSyncAt ? (
                      <>
                        <p className="text-sm text-gray-900 inline-flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-gray-400" />
                          {new Date(active.lastCatalogSyncAt).toLocaleString('es-CL')}
                        </p>
                        {active.lastCatalogSyncStats && (
                          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                            <span className="text-gray-500">Escaneados</span>
                            <span className="text-gray-900 font-mono">{active.lastCatalogSyncStats.scanned}</span>
                            <span className="text-gray-500">Creados</span>
                            <span className="text-green-700 font-mono">{active.lastCatalogSyncStats.created}</span>
                            <span className="text-gray-500">Actualizados</span>
                            <span className="text-sky-700 font-mono">{active.lastCatalogSyncStats.updated}</span>
                            <span className="text-gray-500">Sin cambios</span>
                            <span className="text-gray-700 font-mono">{active.lastCatalogSyncStats.unchanged}</span>
                            <span className="text-gray-500">Errores</span>
                            <span className={active.lastCatalogSyncStats.errors > 0 ? 'text-red-600 font-mono' : 'text-gray-700 font-mono'}>
                              {active.lastCatalogSyncStats.errors}
                            </span>
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-gray-400">Aún no se ha ejecutado</p>
                    )}
                  </div>

                  {/* Config */}
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">
                      <Settings className="w-3 h-3 inline mr-1" /> Sincronización automática
                    </p>
                    <div className="space-y-2">
                      <ConfigToggle
                        label="Stock cada 5 min"
                        hint="El cron actualiza el quantity automáticamente"
                        checked={active.catalogConfig?.autoSyncStock !== false}
                        disabled={updateConfigMutation.isPending}
                        onChange={(v) =>
                          updateConfigMutation.mutate({
                            ...(active.catalogConfig || {}),
                            autoSyncStock: v,
                          })
                        }
                      />
                      <ConfigToggle
                        label="Nombre / precio / imágenes"
                        hint="Sobreescribir cuando cambien en la fuente. Apaga si quieres editar manualmente."
                        checked={active.catalogConfig?.autoSyncProducts === true}
                        disabled={updateConfigMutation.isPending}
                        onChange={(v) =>
                          updateConfigMutation.mutate({
                            ...(active.catalogConfig || {}),
                            autoSyncProducts: v,
                          })
                        }
                      />
                    </div>
                  </div>

                  {/* Manual actions */}
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Ejecutar ahora</p>
                    <div className="space-y-2">
                      <button
                        onClick={runImport}
                        disabled={running !== null}
                        className="w-full inline-flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                      >
                        {running === 'import' ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <ArrowDownToLine className="w-4 h-4" />
                        )}
                        Importar / sincronizar todo
                      </button>
                      <button
                        onClick={runStockSync}
                        disabled={running !== null}
                        className="w-full inline-flex items-center justify-center gap-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                      >
                        {running === 'stock' ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Box className="w-4 h-4" />
                        )}
                        Solo stock
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-900">No tienes una fuente del catálogo configurada</p>
                    <p className="text-xs text-amber-800 mt-1">
                      Selecciona una conexión abajo para que alimente tu catálogo maestro automáticamente.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* ── Eligible candidates ─────────────────────────────────────── */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase mb-3">Conexiones elegibles</p>
              {candidates.filter((c) => !c.isCatalogSource).length === 0 ? (
                <div className="bg-white border border-gray-100 rounded-xl p-8 text-center">
                  <Plug className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">
                    No hay otras conexiones tipo ecommerce que puedan ser fuente del catálogo.
                  </p>
                  <Link
                    href="/connections"
                    className="text-xs text-sky-600 hover:underline inline-block mt-2"
                  >
                    Ir a Conexiones para agregar una →
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {candidates
                    .filter((c) => !c.isCatalogSource)
                    .map((c) => (
                      <div
                        key={c.id}
                        className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between"
                      >
                        <div>
                          <p className="text-sm font-semibold text-gray-900">
                            {PROVIDER_LABELS[c.provider] || c.provider}
                          </p>
                          <p className="text-xs text-gray-500">{c.name}</p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {c.capabilities?.providesStock && <Capability label="Stock" />}
                            {c.capabilities?.providesPrices && <Capability label="Precios" />}
                            {c.capabilities?.providesImages && <Capability label="Imágenes" />}
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            if (active) {
                              if (
                                !confirm(
                                  `Esto reemplazará "${PROVIDER_LABELS[active.provider] || active.provider}" como fuente del catálogo. ¿Continuar?`,
                                )
                              )
                                return
                            }
                            activateMutation.mutate({ id: c.id })
                          }}
                          disabled={activateMutation.isPending}
                          className="px-3 py-1.5 text-xs font-medium bg-sky-600 hover:bg-sky-700 text-white rounded-lg disabled:opacity-50 inline-flex items-center gap-1"
                        >
                          <CheckCircle2 className="w-3 h-3" /> Activar
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ConfigToggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 w-4 h-4 text-sky-600 border-gray-300 rounded focus:ring-sky-500"
      />
      <div>
        <p className="text-sm text-gray-900">{label}</p>
        {hint && <p className="text-xs text-gray-500">{hint}</p>}
      </div>
    </label>
  )
}

function Capability({ label }: { label: string }) {
  return (
    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">
      {label}
    </span>
  )
}
