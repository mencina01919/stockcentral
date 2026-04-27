'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, Warehouse, Loader2, AlertTriangle } from 'lucide-react'
import api from '@/lib/api'
import { Header } from '@/components/layout/header'

export default function InventoryPage() {
  const [search, setSearch] = useState('')
  const [showLowStock, setShowLowStock] = useState(false)
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['inventory', search, showLowStock, page],
    queryFn: () =>
      api.get('/inventory', {
        params: { search, lowStock: showLowStock ? 'true' : undefined, page, limit: 20 },
      }).then((r) => r.data),
  })

  const { data: alertsData } = useQuery({
    queryKey: ['inventory-alerts'],
    queryFn: () => api.get('/inventory/alerts').then((r) => r.data),
  })

  const items = data?.data || []
  const meta = data?.meta
  const alerts = alertsData || []

  return (
    <div className="flex flex-col h-full">
      <Header title="Inventario" subtitle="Gestión de stock centralizado" />

      <div className="flex-1 p-6 overflow-auto space-y-6">
        {alerts.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <span className="text-sm font-semibold text-amber-800">
                {alerts.length} producto{alerts.length > 1 ? 's' : ''} con stock bajo
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {alerts.slice(0, 5).map((a: any) => (
                <span key={a.id} className="px-2 py-1 bg-amber-100 text-amber-700 text-xs rounded-lg font-medium">
                  {a.product?.name} ({a.quantity} ud{a.quantity !== 1 ? 's' : ''})
                </span>
              ))}
              {alerts.length > 5 && <span className="px-2 py-1 bg-amber-100 text-amber-700 text-xs rounded-lg">+{alerts.length - 5} más</span>}
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-4 border-b border-gray-100 flex items-center gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                placeholder="Buscar producto..."
                className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showLowStock}
                onChange={(e) => { setShowLowStock(e.target.checked); setPage(1) }}
                className="w-4 h-4 text-sky-600 rounded"
              />
              <span className="text-sm text-gray-600">Solo bajo stock</span>
            </label>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-16">
              <Warehouse className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No hay registros de inventario</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  {['Producto', 'SKU', 'Bodega', 'Stock', 'Reservado', 'Disponible', 'Stock mínimo', 'Estado'].map((h) => (
                    <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((item: any) => (
                  <tr key={item.id} className={`hover:bg-gray-50 transition-colors ${item.isLowStock ? 'bg-amber-50/30' : ''}`}>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{item.product?.name}</td>
                    <td className="px-6 py-4 text-sm font-mono text-gray-500">{item.product?.sku}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{item.warehouse?.name}</td>
                    <td className="px-6 py-4">
                      <span className={`text-sm font-bold ${item.quantity === 0 ? 'text-red-500' : item.isLowStock ? 'text-amber-500' : 'text-gray-800'}`}>
                        {item.quantity}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">{item.reservedQuantity}</td>
                    <td className="px-6 py-4 text-sm font-medium text-gray-700">{item.availableQuantity}</td>
                    <td className="px-6 py-4 text-sm text-gray-400">{item.minStock}</td>
                    <td className="px-6 py-4">
                      {item.isOutOfStock ? (
                        <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded-full font-medium">Sin stock</span>
                      ) : item.isLowStock ? (
                        <span className="px-2 py-1 bg-amber-100 text-amber-700 text-xs rounded-full font-medium">Stock bajo</span>
                      ) : (
                        <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full font-medium">OK</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {meta && meta.totalPages > 1 && (
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
              <p className="text-sm text-gray-500">{meta.total} registros</p>
              <div className="flex gap-2">
                <button onClick={() => setPage((p) => p - 1)} disabled={!meta.hasPrevPage} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Anterior</button>
                <button onClick={() => setPage((p) => p + 1)} disabled={!meta.hasNextPage} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Siguiente</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
