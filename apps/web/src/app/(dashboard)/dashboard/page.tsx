'use client'

import { useQuery } from '@tanstack/react-query'
import {
  ShoppingCart, Package, Plug, DollarSign,
  Loader2, RefreshCw,
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import api from '@/lib/api'
import { Header } from '@/components/layout/header'
import {
  Panel, MonoLabel, StatTile, Sparkline, Chip, StatusBadge,
} from '@/components/sc/ui'
import {
  formatCurrency, formatRelativeDate, ORDER_STATUS_LABELS,
  CONNECTION_STATUS_LABELS, PROVIDER_LABELS,
} from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'err' | 'blue' | 'low' | 'cyan'> = {
  pending: 'warn',
  confirmed: 'blue',
  processing: 'blue',
  fulfilled: 'cyan',
  completed: 'ok',
  cancelled: 'err',
}

const TODAY = new Date().toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })

export default function DashboardPage() {
  const { user } = useAuthStore()

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => api.get('/dashboard/stats').then((r) => r.data),
    refetchInterval: 60000,
  })

  const stats = data || {}

  const sampleSalesData = [
    { day: 'Lun', ventas: 45000 }, { day: 'Mar', ventas: 72000 },
    { day: 'Mié', ventas: 58000 }, { day: 'Jue', ventas: 91000 },
    { day: 'Vie', ventas: 88000 }, { day: 'Sáb', ventas: 120000 },
    { day: 'Dom', ventas: 95000 },
  ]
  const salesByDay = stats.salesByChannel?.length ? stats.salesByChannel : sampleSalesData

  return (
    <div className="flex flex-col h-full">
      <Header
        breadcrumbs={['CONSOLA', 'DASHBOARD']}
        title={`Bienvenido, ${user?.firstName || 'Usuario'}`}
        subtitle={`Resumen de tu operación · ${TODAY}`}
      />

      <div className="flex-1 px-7 py-6 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--sc-blue-500)' }} />
          </div>
        ) : (
          <div className="space-y-5">
            {/* KPI grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <StatTile
                label="VENTAS DEL MES"
                kpi="GMV · CLP"
                value={formatCurrency(stats.totalSales || 0, user?.tenant?.currency || 'CLP').replace(/^[^\d-]+/, '')}
                prefix="$"
                delta={stats.salesChange}
              />
              <StatTile
                label="ÓRDENES"
                kpi="ORDERS · 30D"
                value={(stats.totalOrders || 0).toLocaleString('es-CL')}
                delta={stats.ordersChange}
              />
              <StatTile
                label="PRODUCTOS ACTIVOS"
                kpi="SKU · TOTAL"
                value={(stats.totalProducts || 0).toLocaleString('es-CL')}
              />
              <StatTile
                label="CONEXIONES"
                kpi="CHANNELS · LIVE"
                value={String(stats.totalConnections || 0)}
              />
            </div>

            {/* Chart + connections */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <Panel className="xl:col-span-2 p-6">
                <div className="flex items-start justify-between mb-5">
                  <div>
                    <MonoLabel tone="blue">// REVENUE.STREAM</MonoLabel>
                    <h3
                      className="mt-1"
                      style={{
                        fontSize: 18,
                        fontWeight: 600,
                        color: 'var(--sc-text-hi)',
                        letterSpacing: '-0.01em',
                      }}
                    >
                      Ventas por canal
                    </h3>
                  </div>
                  <button
                    onClick={() => refetch()}
                    className="sc-btn-ghost"
                    style={{ padding: '7px 9px' }}
                    aria-label="Refrescar"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={salesByDay}>
                    <defs>
                      <linearGradient id="scSalesGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 6" stroke="rgba(96,165,250,0.15)" />
                    <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#6c7d9e', fontFamily: 'JetBrains Mono' }} stroke="rgba(30,58,138,0.10)" />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#6c7d9e', fontFamily: 'JetBrains Mono' }}
                      stroke="rgba(30,58,138,0.10)"
                      tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`}
                    />
                    <Tooltip
                      formatter={(v: number) => formatCurrency(v)}
                      contentStyle={{
                        borderRadius: 8,
                        border: '1px solid var(--sc-line-soft)',
                        background: 'rgba(255,255,255,0.95)',
                        backdropFilter: 'blur(8px)',
                        fontSize: 12,
                      }}
                    />
                    <Area type="monotone" dataKey="ventas" stroke="#2563eb" fill="url(#scSalesGrad)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </Panel>

              <Panel className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <MonoLabel tone="blue">// CHANNELS</MonoLabel>
                    <h3
                      className="mt-1"
                      style={{
                        fontSize: 18,
                        fontWeight: 600,
                        color: 'var(--sc-text-hi)',
                        letterSpacing: '-0.01em',
                      }}
                    >
                      Estado de conexiones
                    </h3>
                  </div>
                </div>
                {stats.connectionStatus?.length > 0 ? (
                  <div className="space-y-3">
                    {stats.connectionStatus.map((conn: any) => {
                      const s = CONNECTION_STATUS_LABELS[conn.status] || CONNECTION_STATUS_LABELS.disconnected
                      const tone =
                        conn.status === 'connected'
                          ? 'ok'
                          : conn.status === 'syncing'
                          ? 'warn'
                          : conn.status === 'error'
                          ? 'err'
                          : 'low'
                      return (
                        <div key={conn.id} className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <span
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: '50%',
                                background:
                                  tone === 'ok'
                                    ? 'var(--sc-ok)'
                                    : tone === 'warn'
                                    ? 'var(--sc-warn)'
                                    : tone === 'err'
                                    ? 'var(--sc-err)'
                                    : 'var(--sc-text-low)',
                              }}
                            />
                            <span style={{ fontSize: 13, color: 'var(--sc-text-hi)' }}>
                              {PROVIDER_LABELS[conn.provider] || conn.name}
                            </span>
                          </div>
                          <Chip tone={tone}>{s.label}</Chip>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Plug className="w-10 h-10 mx-auto mb-2" style={{ color: 'var(--sc-text-faint)' }} />
                    <p style={{ fontSize: 13, color: 'var(--sc-text-low)' }}>Sin conexiones aún</p>
                    <a
                      href="/connections"
                      style={{
                        color: 'var(--sc-blue-600)',
                        fontSize: 12,
                        marginTop: 6,
                        display: 'inline-block',
                        fontWeight: 500,
                      }}
                    >
                      Conectar plataforma →
                    </a>
                  </div>
                )}
              </Panel>
            </div>

            {/* Recent orders */}
            <Panel className="overflow-hidden">
              <div
                className="flex items-center justify-between"
                style={{ padding: '16px 24px', borderBottom: '1px solid var(--sc-line-soft)' }}
              >
                <div>
                  <MonoLabel tone="blue">// ORDERS.RECENT</MonoLabel>
                  <h3
                    className="mt-1"
                    style={{
                      fontSize: 16,
                      fontWeight: 600,
                      color: 'var(--sc-text-hi)',
                      letterSpacing: '-0.01em',
                    }}
                  >
                    Última actividad
                  </h3>
                </div>
                <a
                  href="/orders"
                  className="sc-mono"
                  style={{ color: 'var(--sc-blue-600)', fontSize: 12, fontWeight: 500 }}
                >
                  VER TODAS →
                </a>
              </div>
              {stats.recentOrders?.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full" style={{ fontSize: 13 }}>
                    <thead>
                      <tr>
                        {['#ORDEN', 'CLIENTE', 'CANAL', 'TOTAL', 'ESTADO', 'HACE'].map((h) => (
                          <th
                            key={h}
                            className="sc-mono text-left"
                            style={{
                              padding: '12px 16px',
                              fontSize: 10.5,
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
                      {stats.recentOrders.map((order: any) => {
                        const statusInfo = ORDER_STATUS_LABELS[order.status] || { label: order.status }
                        const tone = STATUS_TONE[order.status] || 'low'
                        return (
                          <tr key={order.id}>
                            <td
                              className="sc-mono"
                              style={{
                                padding: '13px 16px',
                                color: 'var(--sc-blue-600)',
                                fontWeight: 500,
                                borderBottom: '1px solid var(--sc-line-faint)',
                              }}
                            >
                              {order.orderNumber}
                            </td>
                            <td
                              style={{
                                padding: '13px 16px',
                                color: 'var(--sc-text-hi)',
                                borderBottom: '1px solid var(--sc-line-faint)',
                              }}
                            >
                              {order.customerName}
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
                                color: 'var(--sc-text-hi)',
                                fontWeight: 600,
                                borderBottom: '1px solid var(--sc-line-faint)',
                              }}
                            >
                              {formatCurrency(Number(order.total))}
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
                              className="sc-mono"
                              style={{
                                padding: '13px 16px',
                                color: 'var(--sc-text-low)',
                                fontSize: 11,
                                borderBottom: '1px solid var(--sc-line-faint)',
                              }}
                            >
                              {formatRelativeDate(order.createdAt)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-12">
                  <ShoppingCart className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--sc-text-faint)' }} />
                  <p style={{ color: 'var(--sc-text-low)' }}>No hay órdenes aún</p>
                </div>
              )}
            </Panel>
          </div>
        )}
      </div>
    </div>
  )
}
