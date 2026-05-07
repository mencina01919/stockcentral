'use client'

import { useState, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, Package, Loader2, AlertTriangle, CheckCircle2, ExternalLink, RefreshCw, X } from 'lucide-react'
import api from '@/lib/api'
import { Header } from '@/components/layout/header'
import { formatCurrency, PROVIDER_LABELS } from '@/lib/utils'

export default function ProductsByMarketplacePage({ params }: { params: { provider: string } }) {
  const provider = params.provider
  const providerLabel = PROVIDER_LABELS[provider] || provider
  const queryClient = useQueryClient()

  const [search, setSearch]       = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatus] = useState<string>('')
  const [linkedFilter, setLinked] = useState<string>('')
  const [stockFilter, setStock]   = useState<string>('')
  const [page, setPage]           = useState(1)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedExternalId, setSelectedExternalId] = useState<string | null>(null)
  const limit = 25

  // Debounce search — only fire backend request 400ms after user stops typing
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setDebouncedSearch(search); setPage(1) }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  const { data: connections } = useQuery<any[]>({
    queryKey: ['connections'],
    queryFn: () => api.get('/connections').then((r) => r.data),
    staleTime: 60_000,
  })
  const connection = (connections || []).find((c: any) => c.provider === provider)

  const { data, isLoading, error } = useQuery({
    enabled: !!connection?.id,
    queryKey: ['marketplace-products', provider, page, statusFilter, stockFilter, linkedFilter, debouncedSearch],
    queryFn: () =>
      api
        .get(`/products/marketplace/${connection.id}`, {
          params: {
            offset: (page - 1) * limit,
            limit,
            ...(statusFilter     ? { status: statusFilter }       : {}),
            ...(stockFilter      ? { stock: stockFilter }         : {}),
            ...(linkedFilter     ? { linked: linkedFilter }       : {}),
            ...(debouncedSearch  ? { search: debouncedSearch }    : {}),
          },
        })
        .then((r) => r.data),
  })

  const items: any[] = data?.data || []
  const meta = data?.meta

  const resetFilters = () => {
    setSearch(''); setDebouncedSearch(''); setStatus(''); setLinked(''); setStock(''); setPage(1)
  }
  const hasFilters = search || statusFilter || linkedFilter || stockFilter

  const handleRefresh = async () => {
    if (!connection?.id) return
    setRefreshing(true)
    await api.post(`/products/marketplace/${connection.id}/refresh`).catch(() => {})
    await queryClient.invalidateQueries({ queryKey: ['marketplace-products', provider] })
    setRefreshing(false)
  }

  if (!connections) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--sc-blue-500)' }} />
      </div>
    )
  }

  if (!connection) {
    return (
      <div className="flex flex-col h-full">
        <Header
          breadcrumbs={['CONSOLA', 'PRODUCTOS', providerLabel.toUpperCase()]}
          title={`Productos en ${providerLabel}`}
          subtitle="Vista por marketplace"
        />
        <div className="flex-1 px-7 py-6">
          <div
            className="sc-panel text-center"
            style={{
              padding: 32,
              background: 'rgba(217,119,6,0.05)',
              borderColor: 'rgba(217,119,6,0.25)',
            }}
          >
            <AlertTriangle
              className="w-10 h-10 mx-auto mb-3"
              style={{ color: 'var(--sc-warn)' }}
            />
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--sc-text-hi)' }}>
              No hay una conexión configurada para {providerLabel}
            </p>
            <p style={{ fontSize: 12, color: 'var(--sc-text-mid)', marginTop: 6 }}>
              Crea la conexión desde la sección Conexiones para ver tus productos publicados.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <Header
        breadcrumbs={['CONSOLA', 'PRODUCTOS', providerLabel.toUpperCase()]}
        title={`Productos en ${providerLabel}`}
        subtitle={`Productos publicados en ${connection.name}`}
      />

      <div className="flex-1 p-6 overflow-auto">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {/* Filters bar */}
          <div className="p-4 border-b border-gray-100 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              {/* Search */}
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por nombre, SKU o ID..."
                  className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              {/* Estado */}
              <select
                value={statusFilter}
                onChange={e => { setStatus(e.target.value); setPage(1) }}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 text-gray-600"
              >
                <option value="">Todos los estados</option>
                <option value="active">Activo</option>
                <option value="paused">Pausado</option>
                <option value="closed">Cerrado</option>
              </select>

              {/* Stock */}
              <select
                value={stockFilter}
                onChange={e => { setStock(e.target.value); setPage(1) }}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 text-gray-600"
              >
                <option value="">Todo el stock</option>
                <option value="in_stock">Con stock</option>
                <option value="out_of_stock">Sin stock</option>
              </select>

              {/* Vinculación al maestro */}
              <select
                value={linkedFilter}
                onChange={e => { setLinked(e.target.value); setPage(1) }}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 text-gray-600"
              >
                <option value="">Todos (maestro)</option>
                <option value="linked">Vinculado al maestro</option>
                <option value="unlinked">Sin vincular</option>
              </select>

              {/* Reset + conteo + refresh */}
              <div className="flex items-center gap-2 ml-auto">
                <button
                  onClick={handleRefresh}
                  disabled={refreshing}
                  title="Recargar desde ML"
                  className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:text-sky-600 hover:border-sky-300 disabled:opacity-40 transition-colors"
                >
                  <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                </button>
                {hasFilters && (
                  <button
                    onClick={resetFilters}
                    className="text-xs text-sky-600 hover:underline whitespace-nowrap"
                  >
                    Limpiar filtros
                  </button>
                )}
                {meta && (
                  <p className="text-xs text-gray-400 whitespace-nowrap">
                    {items.length} de {meta.total}
                  </p>
                )}
              </div>
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
            </div>
          ) : error ? (
            <div className="text-center py-16">
              <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
              <p className="text-sm font-medium text-amber-800">
                No se pudieron cargar los productos desde {providerLabel}
              </p>
              <p className="text-xs text-amber-700 mt-1">
                {(error as any)?.response?.data?.message || (error as any)?.message || 'Error desconocido'}
              </p>
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-16">
              <Package className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">
                No hay productos publicados en {providerLabel}
              </p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  {['Producto', 'SKU vendedor', 'ID en marketplace', 'Precio', 'Stock', 'Estado', 'Maestro'].map((h) => (
                    <th
                      key={h}
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((p: any) => (
                  <tr
                    key={p.externalId}
                    onClick={() => setSelectedExternalId(p.externalId)}
                    className="hover:bg-sky-50 transition-colors cursor-pointer"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        {p.images?.[0] && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.images[0]}
                            alt=""
                            className="w-10 h-10 object-cover rounded border border-gray-200"
                          />
                        )}
                        <span className="text-sm font-medium text-gray-900">{p.title}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs font-mono text-gray-700">
                      {p.externalSku || '—'}
                    </td>
                    <td className="px-6 py-4 text-xs font-mono text-gray-500">
                      {p.url ? (
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-sky-600 hover:underline"
                        >
                          {p.externalId} <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        p.externalId
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">
                      {p.price ? formatCurrency(Number(p.price), 'CLP') : '—'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">{p.stock ?? '—'}</td>
                    <td className="px-6 py-4">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="px-6 py-4">
                      {p.mapping ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs font-medium">
                          <CheckCircle2 className="w-3 h-3" />
                          {p.mapping.masterSku}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">No vinculado</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {meta && meta.total > limit && (
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
              <p className="text-sm text-gray-500">
                Página {page} — mostrando {items.length} de {meta.total}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((x) => x - 1)}
                  disabled={page === 1}
                  className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50"
                >
                  Anterior
                </button>
                <button
                  onClick={() => setPage((x) => x + 1)}
                  disabled={!meta.hasMore}
                  className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50"
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {selectedExternalId && connection?.id && (
        <ProductDetailPanel
          connectionId={connection.id}
          externalId={selectedExternalId}
          onClose={() => setSelectedExternalId(null)}
        />
      )}
    </div>
  )
}

// ─── Detalle de producto del marketplace (panel lateral) ─────────────────────

function ProductDetailPanel({
  connectionId,
  externalId,
  onClose,
}: {
  connectionId: string
  externalId: string
  onClose: () => void
}) {
  const { data: detail, isLoading, error } = useQuery<any>({
    queryKey: ['marketplace-product-detail', connectionId, externalId],
    queryFn: () =>
      api
        .get(`/products/marketplace/${connectionId}/${encodeURIComponent(externalId)}`)
        .then((r) => r.data),
  })

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-2xl h-full bg-white shadow-2xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-lg font-bold text-gray-900">Detalle del producto</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
          </div>
        )}

        {error && (
          <div className="m-6 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            No se pudo cargar el detalle del producto.
          </div>
        )}

        {detail && (
          <div className="p-6 space-y-6">
            {/* Imágenes */}
            {detail.images?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Imágenes</p>
                <div className="grid grid-cols-4 gap-2">
                  {detail.images.map((url: string, i: number) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={i}
                      src={url}
                      alt=""
                      className="w-full h-24 object-cover rounded border border-gray-200"
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Cabecera */}
            <div>
              <h3 className="text-xl font-bold text-gray-900">{detail.title}</h3>
              <div className="flex flex-wrap items-center gap-3 mt-2">
                {detail.externalSku && (
                  <span className="text-sm font-mono text-gray-500">SKU: {detail.externalSku}</span>
                )}
                <StatusBadge status={detail.status} />
                {detail.url && (
                  <a
                    href={detail.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-sky-600 hover:underline"
                  >
                    Ver en tienda <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>

            {/* Métricas principales */}
            <div className="grid grid-cols-3 gap-3">
              <Metric label="Precio" value={detail.price ? formatCurrency(Number(detail.price), 'CLP') : '—'} />
              <Metric label="Stock" value={detail.stock ?? '—'} />
              <Metric label="Categoría" value={detail.categoryId || '—'} />
            </div>

            {/* Vinculación al maestro */}
            {detail.mapping ? (
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-xs font-semibold text-green-800 uppercase mb-1">Vinculado al maestro</p>
                <p className="text-sm text-green-900 font-mono">{detail.mapping.masterSku}</p>
                <p className="text-xs text-green-700">{detail.mapping.masterName}</p>
              </div>
            ) : (
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <p className="text-xs text-gray-500">No vinculado al catálogo maestro</p>
              </div>
            )}

            {/* Descripción */}
            {detail.description && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Descripción</p>
                <div
                  className="prose prose-sm max-w-none text-gray-700"
                  dangerouslySetInnerHTML={{ __html: detail.description }}
                />
              </div>
            )}

            {/* Datos adicionales del marketplace (rawData) */}
            {detail.rawData && <RawDataSection raw={detail.rawData} />}
          </div>
        )}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: any }) {
  return (
    <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-sm font-semibold text-gray-900 mt-1 break-words">{String(value ?? '—')}</p>
    </div>
  )
}

// Renderiza el rawData del marketplace de forma legible:
// - Especificaciones [{name,value}] como tabla
// - Objetos {prices, stock, images, category} en grids
// - Resto como JSON colapsable
function RawDataSection({ raw }: { raw: any }) {
  if (!raw || typeof raw !== 'object') return null

  const handled = new Set<string>()

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold text-gray-500 uppercase">Datos del marketplace</p>

      {/* Precios */}
      {raw.prices && typeof raw.prices === 'object' && (
        <KvBlock title="Precios" obj={raw.prices} formatValue={(v) => (typeof v === 'number' && v > 100 ? formatCurrency(v, 'CLP') : String(v))} onSeen={() => handled.add('prices')} />
      )}

      {/* Stock */}
      {raw.stock && typeof raw.stock === 'object' && (
        <KvBlock title="Stock" obj={raw.stock} onSeen={() => handled.add('stock')} />
      )}

      {/* Categoría */}
      {raw.category && typeof raw.category === 'object' && (
        <KvBlock title="Categoría" obj={raw.category} onSeen={() => handled.add('category')} />
      )}

      {/* Especificaciones técnicas */}
      {Array.isArray(raw.specifications) && raw.specifications.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-700 mb-2">Especificaciones</p>
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-100">
                {raw.specifications.map((s: any, i: number) => (
                  <tr key={i} className="even:bg-gray-50">
                    <td className="px-3 py-2 text-gray-600 font-medium w-1/3 align-top">{s.name}</td>
                    <td className="px-3 py-2 text-gray-900 break-words">{String(s.value ?? '—')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {handled.add('specifications') && null}
        </div>
      )}

      {/* Resto de campos primitivos / arrays cortos */}
      <SimpleFieldsTable raw={raw} skip={['prices', 'stock', 'category', 'specifications', 'images', 'description']} />

      {/* JSON crudo completo (colapsable) */}
      <details className="text-xs">
        <summary className="cursor-pointer text-gray-500 hover:text-gray-700">Ver JSON crudo</summary>
        <pre className="mt-2 p-3 bg-gray-900 text-gray-100 rounded-lg overflow-x-auto text-[11px] leading-relaxed">
          {JSON.stringify(raw, null, 2)}
        </pre>
      </details>
    </div>
  )
}

function KvBlock({
  title,
  obj,
  formatValue,
  onSeen,
}: {
  title: string
  obj: Record<string, any>
  formatValue?: (v: any) => string
  onSeen?: () => void
}) {
  if (onSeen) onSeen()
  const entries = Object.entries(obj).filter(([, v]) => v !== null && v !== undefined && v !== '')
  if (!entries.length) return null
  return (
    <div>
      <p className="text-xs font-semibold text-gray-700 mb-2">{title}</p>
      <div className="grid grid-cols-2 gap-2">
        {entries.map(([k, v]) => (
          <div key={k} className="bg-gray-50 border border-gray-100 rounded-lg p-2">
            <p className="text-[10px] uppercase text-gray-500">{k}</p>
            <p className="text-sm text-gray-900 break-words">
              {typeof v === 'object' ? JSON.stringify(v) : (formatValue ? formatValue(v) : String(v))}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

function SimpleFieldsTable({ raw, skip }: { raw: Record<string, any>; skip: string[] }) {
  const skipSet = new Set(skip)
  const entries = Object.entries(raw).filter(([k, v]) => {
    if (skipSet.has(k)) return false
    if (v === null || v === undefined || v === '') return false
    if (Array.isArray(v) && v.length === 0) return false
    return true
  })
  if (!entries.length) return null
  return (
    <div>
      <p className="text-xs font-semibold text-gray-700 mb-2">Otros campos</p>
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-gray-100">
            {entries.map(([k, v]) => (
              <tr key={k} className="even:bg-gray-50">
                <td className="px-3 py-2 text-gray-600 font-medium w-1/3 align-top">{k}</td>
                <td className="px-3 py-2 text-gray-900 break-words font-mono text-xs">
                  {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status?: string }) {
  if (status === 'active') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs font-medium">
        Activo
      </span>
    )
  }
  if (status === 'paused') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-xs font-medium">
        Pausado
      </span>
    )
  }
  if (status === 'closed') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs font-medium">
        Cerrado
      </span>
    )
  }
  return <span className="text-xs text-gray-400">{status || '—'}</span>
}
