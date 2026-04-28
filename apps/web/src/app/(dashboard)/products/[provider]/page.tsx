'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, Package, Loader2, ExternalLink, AlertTriangle, CheckCircle2 } from 'lucide-react'
import api from '@/lib/api'
import { Header } from '@/components/layout/header'
import { formatCurrency, PROVIDER_LABELS } from '@/lib/utils'

export default function ProductsByMarketplacePage({ params }: { params: { provider: string } }) {
  const provider = params.provider
  const providerLabel = PROVIDER_LABELS[provider] || provider

  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  // Resolve connection for this provider (one per tenant per provider).
  const { data: connections } = useQuery({
    queryKey: ['connections'],
    queryFn: () => api.get('/connections').then((r) => r.data),
    staleTime: 60_000,
  })
  const connection = (connections?.data || []).find((c: any) => c.provider === provider)

  const { data, isLoading } = useQuery({
    enabled: !!connection?.id,
    queryKey: ['products-by-mp', provider, search, page],
    queryFn: () =>
      api
        .get('/products', {
          params: { connectionId: connection.id, search, page, limit: 20 },
        })
        .then((r) => r.data),
  })

  const products = data?.data || []
  const meta = data?.meta

  if (!connections) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
      </div>
    )
  }

  if (!connection) {
    return (
      <div className="flex flex-col h-full">
        <Header title={`Productos en ${providerLabel}`} subtitle="Vista por marketplace" />
        <div className="flex-1 p-6">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center">
            <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
            <p className="text-sm font-medium text-amber-800">
              No hay una conexión configurada para {providerLabel}
            </p>
            <p className="text-xs text-amber-700 mt-1">
              Crea la conexión desde la sección Conexiones para ver los productos publicados.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <Header
        title={`Productos en ${providerLabel}`}
        subtitle={`Productos vinculados a ${connection.name}`}
      />

      <div className="flex-1 p-6 overflow-auto">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
                placeholder="Buscar por nombre o SKU..."
                className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-16">
              <Package className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">
                No hay productos vinculados a {providerLabel}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Vincúlalos desde el editor de cada producto en{' '}
                <a href="/products/master" className="text-sky-600 hover:underline">
                  Productos / Maestro
                </a>
                .
              </p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  {['Producto', 'SKU', 'Precio base', 'Estado sync', 'Vinculado', 'ID en marketplace'].map((h) => (
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
                {products.map((p: any) => {
                  const mapping = p.marketplaceMappings?.find(
                    (m: any) => m.connectionId === connection.id,
                  )
                  return (
                    <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">{p.name}</td>
                      <td className="px-6 py-4 text-xs font-mono text-gray-500">{p.sku}</td>
                      <td className="px-6 py-4 text-sm text-gray-700">
                        {formatCurrency(Number(p.basePrice), 'CLP')}
                      </td>
                      <td className="px-6 py-4">
                        <SyncBadge status={mapping?.syncStatus} />
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-500">
                        {mapping?.lastSyncAt
                          ? new Date(mapping.lastSyncAt).toLocaleDateString()
                          : '—'}
                      </td>
                      <td className="px-6 py-4 text-xs font-mono text-gray-500">
                        {mapping?.marketplaceProductId || '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          {meta && meta.totalPages > 1 && (
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
              <p className="text-sm text-gray-500">
                {meta.total} productos — Página {meta.page} de {meta.totalPages}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((x) => x - 1)}
                  disabled={!meta.hasPrevPage}
                  className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50"
                >
                  Anterior
                </button>
                <button
                  onClick={() => setPage((x) => x + 1)}
                  disabled={!meta.hasNextPage}
                  className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50"
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SyncBadge({ status }: { status?: string }) {
  if (status === 'connected') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs font-medium">
        <CheckCircle2 className="w-3 h-3" /> Sincronizado
      </span>
    )
  }
  if (status === 'sku_not_found') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-xs font-medium">
        SKU no encontrado
      </span>
    )
  }
  if (status === 'sku_duplicate') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-700 text-xs font-medium">
        SKU duplicado
      </span>
    )
  }
  if (status === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-medium">
        Pendiente
      </span>
    )
  }
  return <span className="text-xs text-gray-400">—</span>
}
