'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, Receipt, Loader2, Eye, Package, MapPin, CreditCard, Layers, FileText, IdCard } from 'lucide-react'
import api from '@/lib/api'
import { Header } from '@/components/layout/header'
import { formatCurrency, formatDate, ORDER_STATUS_LABELS, PROVIDER_LABELS } from '@/lib/utils'

export default function SalesPage({ params }: { params: { channel: string } }) {
  const channel = params.channel
  const sourceFilter = channel === 'all' ? undefined : channel
  const channelLabel =
    channel === 'all' ? 'todos los canales' : PROVIDER_LABELS[channel] || channel

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['sales', channel, search, status, page],
    queryFn: () =>
      api.get('/sales', {
        params: { search, status: status === 'all' ? undefined : status, source: sourceFilter, page, limit: 20 },
      }).then((r) => r.data),
  })

  const sales = data?.data || []
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
      <Header
        title="Ventas"
        subtitle={`Ventas agrupadas de ${channelLabel} — base para facturación`}
      />

      <div className="flex-1 p-6 overflow-auto">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                placeholder="Buscar por # venta, cliente, pack..."
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
          ) : sales.length === 0 ? (
            <div className="text-center py-16">
              <Receipt className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">No hay ventas</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    {['# Venta', 'Cliente', 'Doc', 'Canal', 'Órdenes', 'Total', 'Estado', 'Pago', 'Fecha', 'Acciones'].map((h) => (
                      <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sales.map((sale: any) => {
                    const statusInfo = ORDER_STATUS_LABELS[sale.status] || { label: sale.status, color: 'bg-gray-100 text-gray-600' }
                    const orderCount = sale.orders?.length || 0
                    return (
                      <tr key={sale.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 text-sm font-medium text-sky-600 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            {sale.saleNumber}
                            {orderCount > 1 && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] font-semibold">
                                <Layers className="w-3 h-3" /> {orderCount}
                              </span>
                            )}
                          </div>
                          {sale.externalGroupId && (
                            <p className="text-[10px] text-gray-400 font-mono mt-0.5">pack {sale.externalGroupId}</p>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-sm font-medium text-gray-900">{sale.customerName}</p>
                          {sale.customerEmail && (
                            <p className="text-xs text-gray-400">{sale.customerEmail}</p>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {sale.invoiceType === 'factura' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 text-xs font-semibold">
                              Factura
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs font-medium">
                              Boleta
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500 capitalize">
                          {PROVIDER_LABELS[sale.source] || sale.source}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {orderCount}
                        </td>
                        <td className="px-6 py-4 text-sm font-semibold text-gray-800 whitespace-nowrap">
                          {formatCurrency(Number(sale.total), sale.currency)}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusInfo.color}`}>
                            {statusInfo.label}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`text-xs ${sale.paymentStatus === 'paid' ? 'text-green-600' : 'text-yellow-600'}`}>
                            {sale.paymentStatus === 'paid' ? 'Pagado' : 'Pendiente'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-xs text-gray-400 whitespace-nowrap">
                          {formatDate(sale.createdAt)}
                        </td>
                        <td className="px-6 py-4">
                          <button
                            onClick={() => setSelectedSaleId(sale.id)}
                            className="p-1.5 text-gray-400 hover:text-sky-600 hover:bg-sky-50 rounded transition-colors"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
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
                {meta.total} ventas — Página {meta.page} de {meta.totalPages}
              </p>
              <div className="flex gap-2">
                <button onClick={() => setPage((p) => p - 1)} disabled={!meta.hasPrevPage} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Anterior</button>
                <button onClick={() => setPage((p) => p + 1)} disabled={!meta.hasNextPage} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Siguiente</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {selectedSaleId && (
        <SaleDetailModal saleId={selectedSaleId} onClose={() => setSelectedSaleId(null)} />
      )}
    </div>
  )
}

function SaleDetailModal({ saleId, onClose }: { saleId: string; onClose: () => void }) {
  const { data: sale, isLoading } = useQuery({
    queryKey: ['sale', saleId],
    queryFn: () => api.get(`/sales/${saleId}`).then((r) => r.data),
  })

  if (isLoading || !sale) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <Loader2 className="w-8 h-8 animate-spin text-white" />
      </div>
    )
  }

  const statusInfo = ORDER_STATUS_LABELS[sale.status] || { label: sale.status, color: 'bg-gray-100 text-gray-600' }
  const orders = sale.orders || []

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-3xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-gray-100 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-gray-900">{sale.saleNumber}</h2>
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusInfo.color}`}>
                {statusInfo.label}
              </span>
              {orders.length > 1 && (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-50 text-amber-700 text-xs font-semibold">
                  <Layers className="w-3.5 h-3.5" /> {orders.length} órdenes agrupadas
                </span>
              )}
              {sale.invoiceType === 'factura' ? (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-purple-50 text-purple-700 text-xs font-semibold">
                  <FileText className="w-3.5 h-3.5" /> Factura
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-gray-100 text-gray-600 text-xs font-medium">
                  Boleta
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-1">
              {formatDate(sale.createdAt)}
              {sale.externalGroupId && <> · pack <code className="font-mono">{sale.externalGroupId}</code></>}
            </p>
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
              <p className="text-sm font-medium text-gray-900">{sale.customerName}</p>
              {sale.customerEmail && <p className="text-xs text-gray-500 mt-0.5">{sale.customerEmail}</p>}
              {sale.customerPhone && <p className="text-xs text-gray-500">{sale.customerPhone}</p>}
              {(sale.customerDocType || sale.customerDocNumber) && (
                <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                  <IdCard className="w-3 h-3" />
                  {sale.customerDocType ? `${sale.customerDocType} ` : ''}
                  <span className="font-mono">{sale.customerDocNumber || '—'}</span>
                </p>
              )}
            </div>
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <CreditCard className="w-4 h-4 text-gray-400" />
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Pago total</p>
              </div>
              <p className="text-lg font-semibold text-gray-900">{formatCurrency(Number(sale.total), sale.currency)}</p>
              <p className={`text-xs mt-0.5 ${sale.paymentStatus === 'paid' ? 'text-green-600' : 'text-amber-600'}`}>
                {sale.paymentStatus === 'paid' ? 'Pagado' : 'Pendiente de pago'}
              </p>
              <p className="text-xs text-gray-500 mt-1 capitalize">
                Canal: {PROVIDER_LABELS[sale.source] || sale.source}
              </p>
            </div>
          </div>

          {(sale.billingName || sale.billingDocNumber || sale.billingAddress) && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <FileText className="w-4 h-4 text-amber-600" />
                <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Datos de facturación</p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {sale.billingName && (
                  <div>
                    <p className="text-[10px] text-amber-700 uppercase">Razón social / nombre</p>
                    <p className="text-gray-900">{sale.billingName}</p>
                  </div>
                )}
                {(sale.billingDocType || sale.billingDocNumber) && (
                  <div>
                    <p className="text-[10px] text-amber-700 uppercase">{sale.billingDocType || 'Documento'}</p>
                    <p className="text-gray-900 font-mono">{sale.billingDocNumber || '—'}</p>
                  </div>
                )}
                {sale.billingEmail && (
                  <div>
                    <p className="text-[10px] text-amber-700 uppercase">Email</p>
                    <p className="text-gray-900">{sale.billingEmail}</p>
                  </div>
                )}
                {sale.billingPhone && (
                  <div>
                    <p className="text-[10px] text-amber-700 uppercase">Teléfono</p>
                    <p className="text-gray-900">{sale.billingPhone}</p>
                  </div>
                )}
                {sale.economicActivity && (
                  <div className="col-span-2">
                    <p className="text-[10px] text-amber-700 uppercase">Giro</p>
                    <p className="text-gray-900">{sale.economicActivity}</p>
                  </div>
                )}
                {sale.taxContributor && (
                  <div>
                    <p className="text-[10px] text-amber-700 uppercase">Tipo contribuyente</p>
                    <p className="text-gray-900">{sale.taxContributor}</p>
                  </div>
                )}
              </div>
              {sale.billingAddress && (
                <div className="mt-3 pt-3 border-t border-amber-200">
                  <p className="text-[10px] text-amber-700 uppercase mb-1">Dirección comercial</p>
                  <p className="text-sm text-gray-900">{sale.billingAddress.address1}</p>
                  <p className="text-sm text-gray-700">
                    {sale.billingAddress.city}
                    {sale.billingAddress.state ? `, ${sale.billingAddress.state}` : ''}
                    {sale.billingAddress.zipCode ? ` ${sale.billingAddress.zipCode}` : ''}
                  </p>
                </div>
              )}
            </div>
          )}

          {sale.shippingAddress && (
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <MapPin className="w-4 h-4 text-gray-400" />
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Dirección de envío</p>
              </div>
              <p className="text-sm text-gray-700">{sale.shippingAddress.address1}</p>
              <p className="text-sm text-gray-700">
                {sale.shippingAddress.city}{sale.shippingAddress.state ? `, ${sale.shippingAddress.state}` : ''}
                {sale.shippingAddress.zipCode ? ` ${sale.shippingAddress.zipCode}` : ''}
              </p>
            </div>
          )}

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Órdenes incluidas ({orders.length})
            </p>
            <div className="space-y-3">
              {orders.map((order: any) => {
                const oStatus = ORDER_STATUS_LABELS[order.status] || { label: order.status, color: 'bg-gray-100 text-gray-600' }
                return (
                  <div key={order.id} className="border border-gray-200 rounded-xl overflow-hidden">
                    <div className="bg-gray-50 px-4 py-2.5 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <code className="text-xs font-mono text-sky-700">{order.orderNumber}</code>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${oStatus.color}`}>
                          {oStatus.label}
                        </span>
                      </div>
                      <span className="text-sm font-semibold text-gray-800">
                        {formatCurrency(Number(order.total), order.currency)}
                      </span>
                    </div>
                    {order.items && order.items.length > 0 && (
                      <table className="w-full text-xs">
                        <tbody className="divide-y divide-gray-100">
                          {order.items.map((item: any) => (
                            <tr key={item.id}>
                              <td className="px-4 py-2 text-gray-900">{item.name}</td>
                              <td className="px-4 py-2 font-mono text-gray-500">{item.sku}</td>
                              <td className="px-4 py-2 text-gray-700 text-right">×{item.quantity}</td>
                              <td className="px-4 py-2 text-gray-900 font-medium text-right">
                                {formatCurrency(Number(item.totalPrice), order.currency)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <div className="bg-sky-50 border border-sky-100 rounded-xl p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Subtotal</span>
              <span className="font-medium text-gray-900">{formatCurrency(Number(sale.subtotal), sale.currency)}</span>
            </div>
            {Number(sale.shippingCost) > 0 && (
              <div className="flex items-center justify-between text-sm mt-1">
                <span className="text-gray-600">Envío</span>
                <span className="font-medium text-gray-900">{formatCurrency(Number(sale.shippingCost), sale.currency)}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-base mt-2 pt-2 border-t border-sky-200">
              <span className="font-semibold text-gray-900">Total</span>
              <span className="font-bold text-sky-700">{formatCurrency(Number(sale.total), sale.currency)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
