'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, ShoppingCart, Loader2, Eye } from 'lucide-react'
import api from '@/lib/api'
import { Header } from '@/components/layout/header'
import { formatCurrency, formatDate, ORDER_STATUS_LABELS, PROVIDER_LABELS } from '@/lib/utils'
import { toast } from 'sonner'

export default function OrdersPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['orders', search, status, page],
    queryFn: () =>
      api.get('/orders', {
        params: { search, status: status === 'all' ? undefined : status, page, limit: 20 },
      }).then((r) => r.data),
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/orders/${id}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      toast.success('Orden cancelada')
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Error al cancelar'),
  })

  const orders = data?.data || []
  const meta = data?.meta

  const statusTabs = [
    { key: 'all', label: 'Todas' },
    { key: 'pending', label: 'Pendientes' },
    { key: 'confirmed', label: 'Confirmadas' },
    { key: 'processing', label: 'En proceso' },
    { key: 'fulfilled', label: 'Despachadas' },
    { key: 'completed', label: 'Completadas' },
  ]

  return (
    <div className="flex flex-col h-full">
      <Header title="Órdenes" subtitle="Órdenes consolidadas de todos los canales" />

      <div className="flex-1 p-6 overflow-auto">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                placeholder="Buscar por orden, cliente..."
                className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
          </div>

          <div className="px-4 border-b border-gray-100 flex gap-1 overflow-x-auto">
            {statusTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => { setStatus(tab.key); setPage(1) }}
                className={`px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                  status === tab.key
                    ? 'border-sky-600 text-sky-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
            </div>
          ) : orders.length === 0 ? (
            <div className="text-center py-16">
              <ShoppingCart className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">No hay órdenes</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    {['# Orden', 'Cliente', 'Canal', 'Items', 'Total', 'Estado', 'Pago', 'Fecha', 'Acciones'].map((h) => (
                      <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {orders.map((order: any) => {
                    const statusInfo = ORDER_STATUS_LABELS[order.status] || { label: order.status, color: 'bg-gray-100 text-gray-600' }
                    return (
                      <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 text-sm font-medium text-sky-600 whitespace-nowrap">
                          {order.orderNumber}
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-sm font-medium text-gray-900">{order.customerName}</p>
                          {order.customerEmail && (
                            <p className="text-xs text-gray-400">{order.customerEmail}</p>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500 capitalize">
                          {PROVIDER_LABELS[order.sourceChannel] || order.sourceChannel}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {order.items?.length || 0} items
                        </td>
                        <td className="px-6 py-4 text-sm font-semibold text-gray-800 whitespace-nowrap">
                          {formatCurrency(Number(order.total), order.currency)}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusInfo.color}`}>
                            {statusInfo.label}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`text-xs ${order.paymentStatus === 'paid' ? 'text-green-600' : 'text-yellow-600'}`}>
                            {order.paymentStatus === 'paid' ? 'Pagado' : 'Pendiente'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-xs text-gray-400 whitespace-nowrap">
                          {formatDate(order.createdAt)}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-1">
                            <button className="p-1.5 text-gray-400 hover:text-sky-600 hover:bg-sky-50 rounded transition-colors">
                              <Eye className="w-4 h-4" />
                            </button>
                            {['pending', 'confirmed'].includes(order.status) && (
                              <button
                                onClick={() => cancelMutation.mutate(order.id)}
                                className="px-2 py-1 text-xs text-red-500 hover:bg-red-50 rounded transition-colors"
                              >
                                Cancelar
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {meta && meta.totalPages > 1 && (
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
              <p className="text-sm text-gray-500">
                {meta.total} órdenes — Página {meta.page} de {meta.totalPages}
              </p>
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
