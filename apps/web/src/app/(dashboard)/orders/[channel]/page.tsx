'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, ShoppingCart, Loader2, Eye, Package, MapPin, CreditCard, ExternalLink, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import api from '@/lib/api'
import { Header } from '@/components/layout/header'
import { Panel, StatusBadge, MonoLabel } from '@/components/sc/ui'
import { DatePicker } from '@/components/sc/date-picker'
import {
  formatCurrency,
  formatDate,
  ORDER_STATUS_LABELS,
  PROVIDER_LABELS,
} from '@/lib/utils'

const CHANNEL_STATUS_TONE: Record<string, 'ok' | 'warn' | 'err' | 'blue' | 'low' | 'cyan'> = {
  pending: 'warn',
  confirmed: 'blue',
  processing: 'blue',
  fulfilled: 'cyan',
  completed: 'ok',
  cancelled: 'err',
}

// Estado a mostrar al usuario:
// - Si el marketplace marca mediación abierta (sin cancel_detail aún), gana.
// - Sino, si la cancelación tiene autor (comprador / vendedor / ML), lo mostramos.
// - Sino, cancelada genérica.
// - Sino, mira paymentStatus.
// Hoy solo Mercado Libre llena statusDetail/tags/hasMediations en metadata;
// otros drivers caen al fallback básico.
function deriveOrderStatus(order: any): { label: string; tone: 'ok' | 'warn' | 'err' } {
  const meta = (order.metadata || {}) as { statusDetail?: string; tags?: string[]; hasMediations?: boolean }
  const tags = Array.isArray(meta.tags) ? meta.tags : []
  const detail = meta.statusDetail || ''

  // Mediación abierta — la prioridad es alertar al operador.
  // (hasMediations en local ya descuenta las cerradas por cancel_detail.)
  if (meta.hasMediations || detail === 'mediation_open') {
    return { label: 'En mediación', tone: 'warn' }
  }
  // Reclamo del comprador (claim distinto de mediación).
  if (tags.includes('claim_opened') || tags.includes('claim')) {
    return { label: 'Con reclamo', tone: 'warn' }
  }
  // Devolución del comprador.
  if (tags.includes('return') || tags.includes('returned') || detail === 'returned') {
    return { label: 'Devuelta', tone: 'err' }
  }

  // Cancelaciones con autor identificado (cancel_detail.group de ML).
  if (detail === 'cancelled_by_buyer') return { label: 'Cancelada por comprador', tone: 'err' }
  if (detail === 'cancelled_by_seller') return { label: 'Cancelada por vendedor', tone: 'err' }
  if (detail === 'cancelled_by_ml') return { label: 'Cancelada por ML', tone: 'err' }
  if (detail === 'cancelled_by_delivery') return { label: 'Cancelada por logística', tone: 'err' }

  // Caso no_shipping (envío directo del seller): ML no rastrea la entrega
  // por API y queda con tag not_delivered, pero si el seller dejó feedback
  // ya está cumplida. Mostramos "Entregado".
  if (detail === 'delivered_no_shipping') return { label: 'Entregado', tone: 'ok' }

  // No entregado: el envío falló pero la orden puede o no estar cancelada.
  // Lo mostramos solo si NO está cancelada (si está cancelada, ya gana el
  // motivo de cancelación arriba). Si pasa hasta acá con not_delivered, es
  // que no hay cancelación formal y queremos alertar.
  if (
    (tags.includes('not_delivered') || detail === 'not_delivered') &&
    order.status !== 'cancelled'
  ) {
    return { label: 'No entregado', tone: 'warn' }
  }

  if (order.internalStatus === 'cancelled_internal' || order.status === 'cancelled') {
    return { label: 'Cancelada', tone: 'err' }
  }
  if (order.paymentStatus === 'paid') return { label: 'Pagado', tone: 'ok' }
  return { label: 'Pendiente pago', tone: 'warn' }
}

export default function OrdersPage({ params }: { params: { channel: string } }) {
  const channel = params.channel
  const sourceFilter = channel === 'all' ? undefined : channel
  const channelLabel =
    channel === 'all' ? 'todos los canales' : PROVIDER_LABELS[channel] || channel

  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  type StatusKey = 'all' | 'paid' | 'pending' | 'mediation' | 'not_delivered' | 'cancelled'
  const [statusFilter, setStatusFilter] = useState<StatusKey>('all')
  const [page, setPage] = useState(1)
  const [selectedOrder, setSelectedOrder] = useState<any>(null)
  const [placedFrom, setPlacedFrom] = useState('')
  const [placedTo, setPlacedTo] = useState('')

  // Refresca una orden contra el marketplace (GET /orders/{id}). Útil cuando
  // el operador sospecha que el estado está stale (mediación recién abierta,
  // etc.) y no quiere esperar al webhook o al cron.
  const refreshOrder = useMutation({
    mutationFn: (id: string) => api.post(`/orders/${id}/refresh`).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      toast.success('Estado actualizado desde el marketplace')
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.message || 'No se pudo refrescar la orden'),
  })

  const { data, isLoading } = useQuery({
    queryKey: ['orders', channel, search, statusFilter, page, placedFrom, placedTo],
    queryFn: () => {
      // Mapeamos el filtro simplificado a los params reales del backend.
      const params: Record<string, any> = {
        search,
        source: sourceFilter,
        page,
        limit: 20,
      }
      if (statusFilter === 'paid') params.paymentStatus = 'paid'
      else if (statusFilter === 'pending') params.paymentStatus = 'pending'
      else if (statusFilter === 'mediation') params.situation = 'mediation'
      else if (statusFilter === 'not_delivered') params.situation = 'not_delivered'
      else if (statusFilter === 'cancelled') params.situation = 'cancelled_clean'
      if (placedFrom) params.placedFrom = placedFrom
      if (placedTo) params.placedTo = placedTo
      return api.get('/orders', { params }).then((r) => r.data)
    },
  })

  const orders = data?.data || []
  const meta = data?.meta

  const statusTabs: { key: StatusKey; label: string }[] = [
    { key: 'all', label: 'Todas' },
    { key: 'paid', label: 'Pagadas' },
    { key: 'pending', label: 'Pendiente pago' },
    { key: 'mediation', label: 'En mediación' },
    { key: 'not_delivered', label: 'No entregadas' },
    { key: 'cancelled', label: 'Canceladas' },
  ]

  return (
    <div className="flex flex-col h-full">
      <Header
        breadcrumbs={['CONSOLA', 'ÓRDENES', channel === 'all' ? 'TODAS' : channel.toUpperCase()]}
        title={`Órdenes · ${channel === 'all' ? 'Todos los canales' : channelLabel}`}
        subtitle={meta ? `${meta.total} órdenes · flujo interno de fulfillment` : 'Flujo interno de fulfillment'}
      />

      <div className="flex-1 px-7 py-6 overflow-auto">
        <Panel className="overflow-hidden">
          <div
            className="flex flex-wrap items-center gap-3"
            style={{ padding: 16, borderBottom: '1px solid var(--sc-line-soft)' }}
          >
            <div className="relative" style={{ minWidth: 280, flex: '1 1 280px' }}>
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
            <div className="flex items-center gap-2">
              <span
                className="sc-mono uppercase"
                style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--sc-text-low)' }}
              >
                Desde
              </span>
              <DatePicker
                value={placedFrom}
                onChange={(v) => { setPlacedFrom(v); setPage(1) }}
                className="sc-input"
                style={{ width: 160 }}
              />
              <span
                className="sc-mono uppercase"
                style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--sc-text-low)' }}
              >
                Hasta
              </span>
              <DatePicker
                value={placedTo}
                onChange={(v) => { setPlacedTo(v); setPage(1) }}
                className="sc-input"
                style={{ width: 160 }}
              />
              {(placedFrom || placedTo) && (
                <button
                  onClick={() => { setPlacedFrom(''); setPlacedTo(''); setPage(1) }}
                  className="sc-btn-ghost"
                  style={{ padding: '6px 10px', fontSize: 11 }}
                  title="Limpiar fechas"
                >
                  Limpiar
                </button>
              )}
            </div>
          </div>

          <div
            className="flex gap-1 overflow-x-auto"
            style={{ padding: '0 16px', borderBottom: '1px solid var(--sc-line-soft)' }}
          >
            {statusTabs.map((tab) => {
              const active = statusFilter === tab.key
              return (
                <button
                  key={tab.key}
                  onClick={() => { setStatusFilter(tab.key); setPage(1) }}
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
                    {['#ORDEN', 'CLIENTE', 'CANAL', 'ITEMS', 'TOTAL', 'ESTADO', 'CANAL ESTADO', 'FECHA', ''].map((h, i) => (
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
                    const derived = deriveOrderStatus(order)
                    const channelStatus = ORDER_STATUS_LABELS[order.status] || { label: order.status }
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
                          <StatusBadge tone={derived.tone}>{derived.label}</StatusBadge>
                        </td>
                        <td
                          style={{
                            padding: '13px 16px',
                            borderBottom: '1px solid var(--sc-line-faint)',
                          }}
                        >
                          <span
                            className="sc-mono"
                            title="Estado reportado por el marketplace (informativo)"
                            style={{
                              fontSize: 11,
                              color: 'var(--sc-text-low)',
                              padding: '2px 8px',
                              borderRadius: 4,
                              border: '1px solid var(--sc-line-soft)',
                              background: '#f7f9fd',
                            }}
                          >
                            {channelStatus.label}
                          </span>
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
                          {formatDate(order.placedAt || order.createdAt)}
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
                            {order.externalOrderId && (
                              <button
                                onClick={() => refreshOrder.mutate(order.id)}
                                disabled={refreshOrder.isPending && refreshOrder.variables === order.id}
                                className="sc-btn-ghost"
                                style={{ padding: 6 }}
                                title="Refrescar estado desde el marketplace"
                                aria-label="Refrescar estado"
                              >
                                {refreshOrder.isPending && refreshOrder.variables === order.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <RefreshCw className="w-3.5 h-3.5" />
                                )}
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
        <OrderDetailModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />
      )}
    </div>
  )
}

function OrderDetailModal({
  order, onClose,
}: {
  order: any
  onClose: () => void
}) {
  const derived = deriveOrderStatus(order)
  const channelStatus = ORDER_STATUS_LABELS[order.status] || { label: order.status }

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
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <h2
                style={{ fontSize: 18, fontWeight: 600, color: 'var(--sc-text-hi)', letterSpacing: '-0.01em' }}
              >
                {order.orderNumber}
              </h2>
              <StatusBadge tone={derived.tone}>{derived.label}</StatusBadge>
              <span
                className="sc-mono"
                title="Estado en el marketplace (informativo)"
                style={{
                  fontSize: 10,
                  color: 'var(--sc-text-low)',
                  padding: '2px 8px',
                  borderRadius: 4,
                  border: '1px solid var(--sc-line-soft)',
                  background: '#f7f9fd',
                }}
              >
                CANAL: {channelStatus.label}
              </span>
            </div>
            <p className="sc-mono" style={{ fontSize: 11, color: 'var(--sc-text-low)', marginTop: 4 }}>
              {formatDate(order.placedAt || order.createdAt)}
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

          {order.externalOrderId && (
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
                  {order.externalOrderId}
                </code>
              </span>
            </div>
          )}
        </div>

        <div
          className="flex-shrink-0"
          style={{ padding: '12px 24px', borderTop: '1px solid var(--sc-line-soft)' }}
        >
          <p
            className="sc-mono"
            style={{ fontSize: 10.5, color: 'var(--sc-text-faint)', letterSpacing: '0.14em' }}
          >
            // SOLO LECTURA · LOS ESTADOS SE ACTUALIZAN AUTOMÁTICAMENTE DESDE EL MARKETPLACE
          </p>
        </div>
      </Panel>
    </div>
  )
}
