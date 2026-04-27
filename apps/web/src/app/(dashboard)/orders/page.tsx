'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, ShoppingCart, Loader2, Eye, Package, MapPin, CreditCard, ExternalLink } from 'lucide-react'
import api from '@/lib/api'
import { Header } from '@/components/layout/header'
import { formatCurrency, formatDate, ORDER_STATUS_LABELS, PROVIDER_LABELS } from '@/lib/utils'
import { toast } from 'sonner'

export default function OrdersPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [selectedOrder, setSelectedOrder] = useState<any>(null)

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
                            <button
                              onClick={() => setSelectedOrder(order)}
                              className="p-1.5 text-gray-400 hover:text-sky-600 hover:bg-sky-50 rounded transition-colors"
                            >
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

      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onStatusChange={() => {
            queryClient.invalidateQueries({ queryKey: ['orders'] })
            setSelectedOrder(null)
          }}
        />
      )}
    </div>
  )
}

function OrderDetailModal({ order, onClose, onStatusChange }: { order: any; onClose: () => void; onStatusChange: () => void }) {
  const statusInfo = ORDER_STATUS_LABELS[order.status] || { label: order.status, color: 'bg-gray-100 text-gray-600' }

  const advanceMutation = useMutation({
    mutationFn: () => api.patch(`/orders/${order.id}/advance`),
    onSuccess: () => {
      toast.success('Estado actualizado')
      onStatusChange()
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Error al actualizar estado'),
  })

  const cancelMutation = useMutation({
    mutationFn: () => api.patch(`/orders/${order.id}/cancel`),
    onSuccess: () => {
      toast.success('Orden cancelada')
      onStatusChange()
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'No se puede cancelar en este estado'),
  })

  const canAdvance = !['fulfilled', 'completed', 'cancelled'].includes(order.status)
  const canCancel = ['pending', 'confirmed'].includes(order.status)

  const nextStatus: Record<string, string> = {
    pending: 'Confirmar',
    confirmed: 'Procesar',
    processing: 'Despachar',
    fulfilled: 'Completar',
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-gray-100 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-gray-900">{order.orderNumber}</h2>
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusInfo.color}`}>
                {statusInfo.label}
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-1">{formatDate(order.createdAt)}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Package className="w-4 h-4 text-gray-400" />
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Cliente</p>
              </div>
              <p className="text-sm font-medium text-gray-900">{order.customerName}</p>
              {order.customerEmail && <p className="text-xs text-gray-500 mt-0.5">{order.customerEmail}</p>}
              {order.customerPhone && <p className="text-xs text-gray-500">{order.customerPhone}</p>}
            </div>
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <CreditCard className="w-4 h-4 text-gray-400" />
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Pago</p>
              </div>
              <p className="text-sm font-medium text-gray-900">{formatCurrency(Number(order.total), order.currency)}</p>
              <p className={`text-xs mt-0.5 ${order.paymentStatus === 'paid' ? 'text-green-600' : 'text-amber-600'}`}>
                {order.paymentStatus === 'paid' ? 'Pagado' : 'Pendiente de pago'}
              </p>
              <p className="text-xs text-gray-500 mt-1 capitalize">
                Canal: {PROVIDER_LABELS[order.sourceChannel] || order.sourceChannel}
              </p>
            </div>
          </div>

          {order.shippingAddress && (
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <MapPin className="w-4 h-4 text-gray-400" />
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Dirección de envío</p>
              </div>
              <p className="text-sm text-gray-700">
                {order.shippingAddress.address1}
                {order.shippingAddress.address2 && `, ${order.shippingAddress.address2}`}
              </p>
              <p className="text-sm text-gray-700">
                {order.shippingAddress.city}{order.shippingAddress.state ? `, ${order.shippingAddress.state}` : ''}
                {order.shippingAddress.zip ? ` ${order.shippingAddress.zip}` : ''}
              </p>
              {order.shippingAddress.country && <p className="text-sm text-gray-700">{order.shippingAddress.country}</p>}
            </div>
          )}

          {order.items && order.items.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Productos</p>
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      {['Producto', 'SKU', 'Cant.', 'Precio unit.', 'Total'].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {order.items.map((item: any) => (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-900 text-xs">{item.productName}</td>
                        <td className="px-4 py-3 font-mono text-gray-500 text-xs">{item.sku}</td>
                        <td className="px-4 py-3 text-gray-700 text-xs">{item.quantity}</td>
                        <td className="px-4 py-3 text-gray-700 text-xs">{formatCurrency(Number(item.unitPrice), order.currency)}</td>
                        <td className="px-4 py-3 font-semibold text-gray-900 text-xs">{formatCurrency(Number(item.totalPrice), order.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50">
                    <tr>
                      <td colSpan={4} className="px-4 py-2.5 text-right text-xs font-semibold text-gray-700">Total</td>
                      <td className="px-4 py-2.5 text-xs font-bold text-gray-900">{formatCurrency(Number(order.total), order.currency)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {order.externalId && (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <ExternalLink className="w-3.5 h-3.5" />
              <span>ID externo: <code className="font-mono bg-gray-100 px-1 rounded">{order.externalId}</code></span>
            </div>
          )}
        </div>

        {(canAdvance || canCancel) && (
          <div className="p-5 border-t border-gray-100 flex gap-3">
            {canCancel && (
              <button
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
                className="px-4 py-2 border border-red-200 text-red-600 hover:bg-red-50 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
              >
                {cancelMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Cancelar orden
              </button>
            )}
            {canAdvance && nextStatus[order.status] && (
              <button
                onClick={() => advanceMutation.mutate()}
                disabled={advanceMutation.isPending}
                className="flex-1 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
              >
                {advanceMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                {nextStatus[order.status]}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
