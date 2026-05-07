'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, ShoppingCart, Loader2, Eye, Package, MapPin, CreditCard, ExternalLink } from 'lucide-react'
import api from '@/lib/api'
import { Header } from '@/components/layout/header'
import { Panel, Chip, StatusBadge, MonoLabel } from '@/components/sc/ui'
import { formatCurrency, formatDate, ORDER_STATUS_LABELS, PROVIDER_LABELS } from '@/lib/utils'
import { toast } from 'sonner'

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'err' | 'blue' | 'low' | 'cyan'> = {
  pending: 'warn',
  confirmed: 'blue',
  processing: 'blue',
  fulfilled: 'cyan',
  completed: 'ok',
  cancelled: 'err',
}

export default function OrdersPage({ params }: { params: { channel: string } }) {
  const channel = params.channel
  const sourceFilter = channel === 'all' ? undefined : channel
  const channelLabel =
    channel === 'all' ? 'todos los canales' : PROVIDER_LABELS[channel] || channel

  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [selectedOrder, setSelectedOrder] = useState<any>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['orders', channel, search, status, page],
    queryFn: () =>
      api.get('/orders', {
        params: { search, status: status === 'all' ? undefined : status, source: sourceFilter, page, limit: 20 },
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
      <Header
        breadcrumbs={['CONSOLA', 'ÓRDENES', channel === 'all' ? 'TODAS' : channel.toUpperCase()]}
        title={`Órdenes · ${channel === 'all' ? 'Todos los canales' : channelLabel}`}
        subtitle={meta ? `${meta.total} órdenes encontradas` : 'Gestión de órdenes omnicanal'}
      />

      <div className="flex-1 px-7 py-6 overflow-auto">
        <Panel className="overflow-hidden">
          <div style={{ padding: 16, borderBottom: '1px solid var(--sc-line-soft)' }}>
            <div className="relative max-w-sm">
              <Search
                className="w-3.5 h-3.5 absolute"
                style={{ left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--sc-text-low)' }}
              />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                placeholder="Buscar #orden, cliente, email…"
                className="sc-input"
                style={{ paddingLeft: 38 }}
              />
            </div>
          </div>

          <div
            className="flex gap-1 overflow-x-auto"
            style={{ padding: '0 16px', borderBottom: '1px solid var(--sc-line-soft)' }}
          >
            {statusTabs.map((tab) => {
              const active = status === tab.key
              return (
                <button
                  key={tab.key}
                  onClick={() => { setStatus(tab.key); setPage(1) }}
                  style={{
                    padding: '13px 16px',
                    fontSize: 13,
                    fontWeight: 500,
                    color: active ? 'var(--sc-blue-600)' : 'var(--sc-text-mid)',
                    borderBottom: `2px solid ${active ? 'var(--sc-blue-600)' : 'transparent'}`,
                    background: 'transparent',
                    border: 'none',
                    borderBottomWidth: 2,
                    borderBottomStyle: 'solid',
                    borderBottomColor: active ? 'var(--sc-blue-600)' : 'transparent',
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                    transition: 'color .15s',
                  }}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--sc-blue-500)' }} />
            </div>
          ) : orders.length === 0 ? (
            <div className="text-center py-16">
              <ShoppingCart className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--sc-text-faint)' }} />
              <p style={{ color: 'var(--sc-text-low)', fontWeight: 500 }}>No hay órdenes</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    {['#ORDEN', 'CLIENTE', 'CANAL', 'ITEMS', 'TOTAL', 'ESTADO', 'PAGO', 'FECHA', ''].map((h, i) => (
                      <th
                        key={i}
                        className="sc-mono text-left"
                        style={{
                          padding: '12px 16px',
                          fontSize: 10.5,
                          letterSpacing: '0.16em',
                          color: 'var(--sc-text-low)',
                          background: '#f7f9fd',
                          borderBottom: '1px solid var(--sc-line-soft)',
                          fontWeight: 500,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order: any) => {
                    const statusInfo = ORDER_STATUS_LABELS[order.status] || { label: order.status }
                    const tone = STATUS_TONE[order.status] || 'low'
                    return (
                      <tr key={order.id} className="sc-row">
                        <td
                          className="sc-mono"
                          style={{
                            padding: '13px 16px',
                            color: 'var(--sc-blue-600)',
                            fontWeight: 500,
                            borderBottom: '1px solid var(--sc-line-faint)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {order.orderNumber}
                        </td>
                        <td
                          style={{
                            padding: '13px 16px',
                            borderBottom: '1px solid var(--sc-line-faint)',
                          }}
                        >
                          <div style={{ color: 'var(--sc-text-hi)', fontWeight: 500 }}>{order.customerName}</div>
                          {order.customerEmail && (
                            <div className="sc-mono" style={{ fontSize: 11, color: 'var(--sc-text-low)', marginTop: 2 }}>
                              {order.customerEmail}
                            </div>
                          )}
                        </td>
                        <td
                          style={{
                            padding: '13px 16px',
                            color: 'var(--sc-text-mid)',
                            borderBottom: '1px solid var(--sc-line-faint)',
                          }}
                        >
                          {PROVIDER_LABELS[order.sourceChannel] || order.sourceChannel}
                        </td>
                        <td
                          className="sc-mono"
                          style={{
                            padding: '13px 16px',
                            color: 'var(--sc-text-mid)',
                            borderBottom: '1px solid var(--sc-line-faint)',
                          }}
                        >
                          {order.items?.length || 0}
                        </td>
                        <td
                          className="sc-mono"
                          style={{
                            padding: '13px 16px',
                            fontWeight: 600,
                            color: 'var(--sc-text-hi)',
                            borderBottom: '1px solid var(--sc-line-faint)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {formatCurrency(Number(order.total), order.currency)}
                        </td>
                        <td
                          style={{
                            padding: '13px 16px',
                            borderBottom: '1px solid var(--sc-line-faint)',
                          }}
                        >
                          <StatusBadge tone={tone}>{statusInfo.label}</StatusBadge>
                        </td>
                        <td
                          style={{
                            padding: '13px 16px',
                            fontSize: 12,
                            color:
                              order.paymentStatus === 'paid'
                                ? 'var(--sc-ok)'
                                : 'var(--sc-warn)',
                            borderBottom: '1px solid var(--sc-line-faint)',
                          }}
                        >
                          {order.paymentStatus === 'paid' ? 'Pagado' : 'Pendiente'}
                        </td>
                        <td
                          className="sc-mono"
                          style={{
                            padding: '13px 16px',
                            fontSize: 11,
                            color: 'var(--sc-text-low)',
                            borderBottom: '1px solid var(--sc-line-faint)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {formatDate(order.createdAt)}
                        </td>
                        <td
                          style={{
                            padding: '13px 16px',
                            borderBottom: '1px solid var(--sc-line-faint)',
                          }}
                        >
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setSelectedOrder(order)}
                              className="sc-btn-ghost"
                              style={{ padding: 6 }}
                              aria-label="Ver detalle"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            {['pending', 'confirmed'].includes(order.status) && (
                              <button
                                onClick={() => cancelMutation.mutate(order.id)}
                                style={{
                                  padding: '5px 10px',
                                  fontSize: 11,
                                  color: 'var(--sc-err)',
                                  borderRadius: 6,
                                  background: 'transparent',
                                  border: '1px solid rgba(220,38,38,0.20)',
                                  cursor: 'pointer',
                                  transition: 'background .15s',
                                }}
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
            <div
              className="flex items-center justify-between"
              style={{ padding: '14px 20px', borderTop: '1px solid var(--sc-line-soft)' }}
            >
              <p className="sc-mono" style={{ fontSize: 11, color: 'var(--sc-text-low)', letterSpacing: '0.14em' }}>
                {meta.total} ÓRDENES · PÁGINA {meta.page} DE {meta.totalPages}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => p - 1)}
                  disabled={!meta.hasPrevPage}
                  className="sc-btn-ghost"
                  style={{ padding: '6px 14px', fontSize: 12 }}
                >
                  Anterior
                </button>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!meta.hasNextPage}
                  className="sc-btn-ghost"
                  style={{ padding: '6px 14px', fontSize: 12 }}
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </Panel>
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

function OrderDetailModal({
  order, onClose, onStatusChange,
}: {
  order: any
  onClose: () => void
  onStatusChange: () => void
}) {
  const statusInfo = ORDER_STATUS_LABELS[order.status] || { label: order.status }
  const tone = STATUS_TONE[order.status] || 'low'

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
    <div
      className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(11,31,63,0.5)', backdropFilter: 'blur(4px)' }}
    >
      <Panel className="w-full max-w-2xl flex flex-col" style={{ maxHeight: '90vh' }}>
        <div
          className="flex items-start justify-between flex-shrink-0"
          style={{ padding: 24, borderBottom: '1px solid var(--sc-line-soft)' }}
        >
          <div>
            <MonoLabel tone="blue">// ORDER.DETAIL</MonoLabel>
            <div className="flex items-center gap-3 mt-1">
              <h2
                style={{ fontSize: 18, fontWeight: 600, color: 'var(--sc-text-hi)', letterSpacing: '-0.01em' }}
              >
                {order.orderNumber}
              </h2>
              <StatusBadge tone={tone}>{statusInfo.label}</StatusBadge>
            </div>
            <p className="sc-mono" style={{ fontSize: 11, color: 'var(--sc-text-low)', marginTop: 4 }}>
              {formatDate(order.createdAt)}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              color: 'var(--sc-text-low)',
              fontSize: 24,
              lineHeight: 1,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-5" style={{ padding: 24 }}>
          <div className="grid grid-cols-2 gap-4">
            <Panel
              className="sc-panel-flat"
              style={{ padding: 16, background: '#f7f9fd', boxShadow: 'none' }}
            >
              <div className="flex items-center gap-2 mb-3">
                <Package className="w-3.5 h-3.5" style={{ color: 'var(--sc-text-low)' }} />
                <MonoLabel>CLIENTE</MonoLabel>
              </div>
              <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--sc-text-hi)' }}>{order.customerName}</p>
              {order.customerEmail && (
                <p style={{ fontSize: 12, color: 'var(--sc-text-low)', marginTop: 2 }}>{order.customerEmail}</p>
              )}
              {order.customerPhone && (
                <p style={{ fontSize: 12, color: 'var(--sc-text-low)' }}>{order.customerPhone}</p>
              )}
            </Panel>
            <Panel
              className="sc-panel-flat"
              style={{ padding: 16, background: '#f7f9fd', boxShadow: 'none' }}
            >
              <div className="flex items-center gap-2 mb-3">
                <CreditCard className="w-3.5 h-3.5" style={{ color: 'var(--sc-text-low)' }} />
                <MonoLabel>PAGO</MonoLabel>
              </div>
              <p
                className="sc-mono"
                style={{ fontSize: 14, fontWeight: 600, color: 'var(--sc-text-hi)' }}
              >
                {formatCurrency(Number(order.total), order.currency)}
              </p>
              <p
                style={{
                  fontSize: 12,
                  marginTop: 2,
                  color: order.paymentStatus === 'paid' ? 'var(--sc-ok)' : 'var(--sc-warn)',
                }}
              >
                {order.paymentStatus === 'paid' ? 'Pagado' : 'Pendiente de pago'}
              </p>
              <p style={{ fontSize: 12, color: 'var(--sc-text-low)', marginTop: 4 }}>
                Canal: {PROVIDER_LABELS[order.sourceChannel] || order.sourceChannel}
              </p>
            </Panel>
          </div>

          {order.shippingAddress && (
            <Panel
              className="sc-panel-flat"
              style={{ padding: 16, background: '#f7f9fd', boxShadow: 'none' }}
            >
              <div className="flex items-center gap-2 mb-3">
                <MapPin className="w-3.5 h-3.5" style={{ color: 'var(--sc-text-low)' }} />
                <MonoLabel>DIRECCIÓN DE ENVÍO</MonoLabel>
              </div>
              <p style={{ fontSize: 13, color: 'var(--sc-text-hi)' }}>
                {order.shippingAddress.address1}
                {order.shippingAddress.address2 && `, ${order.shippingAddress.address2}`}
              </p>
              <p style={{ fontSize: 13, color: 'var(--sc-text-mid)' }}>
                {order.shippingAddress.city}{order.shippingAddress.state ? `, ${order.shippingAddress.state}` : ''}
                {order.shippingAddress.zip ? ` ${order.shippingAddress.zip}` : ''}
              </p>
              {order.shippingAddress.country && (
                <p style={{ fontSize: 13, color: 'var(--sc-text-mid)' }}>{order.shippingAddress.country}</p>
              )}
            </Panel>
          )}

          {order.items && order.items.length > 0 && (
            <div>
              <MonoLabel>PRODUCTOS</MonoLabel>
              <Panel className="overflow-hidden mt-2">
                <table className="w-full" style={{ fontSize: 13 }}>
                  <thead>
                    <tr>
                      {['Producto', 'SKU', 'Cant.', 'Precio unit.', 'Total'].map((h) => (
                        <th
                          key={h}
                          className="sc-mono text-left uppercase"
                          style={{
                            padding: '10px 14px',
                            fontSize: 10,
                            letterSpacing: '0.16em',
                            color: 'var(--sc-text-low)',
                            background: '#f7f9fd',
                            borderBottom: '1px solid var(--sc-line-soft)',
                            fontWeight: 500,
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {order.items.map((item: any) => (
                      <tr key={item.id}>
                        <td
                          style={{
                            padding: '10px 14px',
                            color: 'var(--sc-text-hi)',
                            fontWeight: 500,
                            fontSize: 12,
                            borderBottom: '1px solid var(--sc-line-faint)',
                          }}
                        >
                          {item.name}
                        </td>
                        <td
                          className="sc-mono"
                          style={{
                            padding: '10px 14px',
                            color: 'var(--sc-text-low)',
                            fontSize: 12,
                            borderBottom: '1px solid var(--sc-line-faint)',
                          }}
                        >
                          {item.sku}
                        </td>
                        <td
                          className="sc-mono"
                          style={{
                            padding: '10px 14px',
                            color: 'var(--sc-text-mid)',
                            fontSize: 12,
                            borderBottom: '1px solid var(--sc-line-faint)',
                          }}
                        >
                          {item.quantity}
                        </td>
                        <td
                          className="sc-mono"
                          style={{
                            padding: '10px 14px',
                            color: 'var(--sc-text-mid)',
                            fontSize: 12,
                            borderBottom: '1px solid var(--sc-line-faint)',
                          }}
                        >
                          {formatCurrency(Number(item.unitPrice), order.currency)}
                        </td>
                        <td
                          className="sc-mono"
                          style={{
                            padding: '10px 14px',
                            color: 'var(--sc-text-hi)',
                            fontWeight: 600,
                            fontSize: 12,
                            borderBottom: '1px solid var(--sc-line-faint)',
                          }}
                        >
                          {formatCurrency(Number(item.totalPrice), order.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td
                        colSpan={4}
                        className="sc-mono uppercase"
                        style={{
                          padding: '10px 14px',
                          background: '#f7f9fd',
                          textAlign: 'right',
                          fontSize: 11,
                          fontWeight: 600,
                          color: 'var(--sc-text-mid)',
                          letterSpacing: '0.14em',
                        }}
                      >
                        Total
                      </td>
                      <td
                        className="sc-mono"
                        style={{
                          padding: '10px 14px',
                          background: '#f7f9fd',
                          fontSize: 13,
                          fontWeight: 700,
                          color: 'var(--sc-text-hi)',
                        }}
                      >
                        {formatCurrency(Number(order.total), order.currency)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </Panel>
            </div>
          )}

          {order.externalId && (
            <div className="flex items-center gap-2" style={{ fontSize: 12, color: 'var(--sc-text-low)' }}>
              <ExternalLink className="w-3.5 h-3.5" />
              <span>
                ID externo:{' '}
                <code
                  className="sc-mono"
                  style={{
                    background: 'rgba(30,58,138,0.05)',
                    padding: '2px 6px',
                    borderRadius: 4,
                    fontSize: 11,
                  }}
                >
                  {order.externalId}
                </code>
              </span>
            </div>
          )}
        </div>

        {(canAdvance || canCancel) && (
          <div
            className="flex gap-3 flex-shrink-0"
            style={{ padding: 20, borderTop: '1px solid var(--sc-line-soft)' }}
          >
            {canCancel && (
              <button
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
                className="sc-btn-ghost"
                style={{
                  color: 'var(--sc-err)',
                  borderColor: 'rgba(220,38,38,0.30)',
                  padding: '10px 16px',
                  fontSize: 13,
                }}
              >
                {cancelMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                Cancelar orden
              </button>
            )}
            {canAdvance && nextStatus[order.status] && (
              <button
                onClick={() => advanceMutation.mutate()}
                disabled={advanceMutation.isPending}
                className="sc-btn-primary"
                style={{ flex: 1, justifyContent: 'center', padding: '10px 16px', fontSize: 13 }}
              >
                {advanceMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                {nextStatus[order.status]}
              </button>
            )}
          </div>
        )}
      </Panel>
    </div>
  )
}
