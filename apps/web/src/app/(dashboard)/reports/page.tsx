'use client'

import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import { BarChart3, Loader2 } from 'lucide-react'
import api from '@/lib/api'
import { Header } from '@/components/layout/header'
import { Panel, MonoLabel, StatTile } from '@/components/sc/ui'
import { formatCurrency } from '@/lib/utils'

const STATUS_COLORS: Record<string, string> = {
  pending: '#d97706',
  processing: '#3b82f6',
  completed: '#10b981',
  cancelled: '#dc2626',
}

export default function ReportsPage() {
  const { data: ordersStats, isLoading } = useQuery({
    queryKey: ['orders-stats'],
    queryFn: () => api.get('/orders/stats').then((r) => r.data),
  })

  const { data: dashboardData } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: () => api.get('/dashboard/stats').then((r) => r.data),
  })

  const salesByChannel = dashboardData?.salesByChannel || []

  const orderStatusData = ordersStats
    ? [
        { name: 'Pendientes', value: ordersStats.pending, color: STATUS_COLORS.pending },
        { name: 'En proceso', value: ordersStats.processing, color: STATUS_COLORS.processing },
        { name: 'Completadas', value: ordersStats.completed, color: STATUS_COLORS.completed },
        { name: 'Canceladas', value: ordersStats.cancelled, color: STATUS_COLORS.cancelled },
      ].filter((d) => d.value > 0)
    : []

  return (
    <div className="flex flex-col h-full">
      <Header
        breadcrumbs={['CONSOLA', 'REPORTES']}
        title="Reportes & Analítica"
        subtitle="Análisis de ventas e inventario"
      />

      <div className="flex-1 px-7 py-6 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--sc-blue-500)' }} />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Hero panel with revenue */}
            <Panel className="relative overflow-hidden" style={{ padding: 28 }}>
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'radial-gradient(ellipse at top right, rgba(59,130,246,0.18), transparent 50%)',
                  pointerEvents: 'none',
                }}
              />
              <div className="relative grid grid-cols-1 lg:grid-cols-3 gap-6 items-center">
                <div>
                  <MonoLabel tone="blue">// GMV · ESTE MES</MonoLabel>
                  <div
                    className="sc-mono"
                    style={{
                      fontSize: 56,
                      fontWeight: 600,
                      letterSpacing: '-0.03em',
                      lineHeight: 1,
                      color: 'var(--sc-text-hi)',
                      fontFeatureSettings: '"tnum"',
                      marginTop: 12,
                    }}
                  >
                    {formatCurrency(dashboardData?.totalSales || 0)}
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--sc-text-low)', marginTop: 14 }}>
                    {dashboardData?.totalOrders || 0} órdenes ·{' '}
                    {dashboardData?.totalProducts || 0} productos activos
                  </p>
                </div>
                <div className="lg:col-span-2">
                  {salesByChannel.length > 0 ? (
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={salesByChannel}>
                        <defs>
                          <linearGradient id="scReportsBar" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.95} />
                            <stop offset="100%" stopColor="#1d4ed8" stopOpacity={0.7} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 6" stroke="rgba(96,165,250,0.15)" />
                        <XAxis
                          dataKey="channel"
                          tick={{ fontSize: 11, fill: '#6c7d9e', fontFamily: 'JetBrains Mono' }}
                          stroke="rgba(30,58,138,0.10)"
                        />
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
                        <Bar dataKey="sales" fill="url(#scReportsBar)" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div
                      className="flex items-center justify-center h-44"
                      style={{ color: 'var(--sc-text-faint)' }}
                    >
                      <div className="text-center">
                        <BarChart3 className="w-10 h-10 mx-auto mb-2" />
                        <p style={{ fontSize: 13 }}>Sin datos de ventas aún</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </Panel>

            {/* KPI tiles */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatTile
                label="REVENUE DEL MES"
                kpi="GMV · CLP"
                value={formatCurrency(dashboardData?.totalSales || 0).replace(/^[^\d-]+/, '')}
                prefix="$"
              />
              <StatTile
                label="ÓRDENES DEL MES"
                kpi="ORDERS · TOTAL"
                value={(dashboardData?.totalOrders || 0).toLocaleString('es-CL')}
              />
              <StatTile
                label="PRODUCTOS ACTIVOS"
                kpi="SKU · LIVE"
                value={(dashboardData?.totalProducts || 0).toLocaleString('es-CL')}
              />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              <Panel className="p-6">
                <MonoLabel tone="blue">// CHANNEL.PERFORMANCE</MonoLabel>
                <h3
                  className="mt-1 mb-5"
                  style={{ fontSize: 18, fontWeight: 600, color: 'var(--sc-text-hi)', letterSpacing: '-0.01em' }}
                >
                  Ventas por canal
                </h3>
                {salesByChannel.length > 0 ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={salesByChannel}>
                      <defs>
                        <linearGradient id="scChannelBar" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.95} />
                          <stop offset="100%" stopColor="#1d4ed8" stopOpacity={0.7} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 6" stroke="rgba(96,165,250,0.15)" />
                      <XAxis dataKey="channel" tick={{ fontSize: 11, fill: '#6c7d9e' }} stroke="rgba(30,58,138,0.10)" />
                      <YAxis
                        tick={{ fontSize: 11, fill: '#6c7d9e' }}
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
                      <Bar dataKey="sales" fill="url(#scChannelBar)" radius={[4, 4, 0, 0]} name="Ventas" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-48" style={{ color: 'var(--sc-text-faint)' }}>
                    <div className="text-center">
                      <BarChart3 className="w-10 h-10 mx-auto mb-2" />
                      <p style={{ fontSize: 13 }}>Sin datos de ventas aún</p>
                    </div>
                  </div>
                )}
              </Panel>

              <Panel className="p-6">
                <MonoLabel tone="blue">// ORDERS.STATUS</MonoLabel>
                <h3
                  className="mt-1 mb-5"
                  style={{ fontSize: 18, fontWeight: 600, color: 'var(--sc-text-hi)', letterSpacing: '-0.01em' }}
                >
                  Estado de órdenes
                </h3>
                {orderStatusData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie
                        data={orderStatusData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={4}
                      >
                        {orderStatusData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Legend wrapperStyle={{ fontSize: 12, color: '#46587a' }} />
                      <Tooltip
                        contentStyle={{
                          borderRadius: 8,
                          border: '1px solid var(--sc-line-soft)',
                          background: 'rgba(255,255,255,0.95)',
                          backdropFilter: 'blur(8px)',
                          fontSize: 12,
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-48" style={{ color: 'var(--sc-text-faint)' }}>
                    <p style={{ fontSize: 13 }}>Sin órdenes registradas</p>
                  </div>
                )}
              </Panel>
            </div>

            {ordersStats && (
              <Panel className="overflow-hidden">
                <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--sc-line-soft)' }}>
                  <MonoLabel tone="blue">// ORDERS.SUMMARY</MonoLabel>
                  <h3
                    className="mt-1"
                    style={{
                      fontSize: 16,
                      fontWeight: 600,
                      color: 'var(--sc-text-hi)',
                      letterSpacing: '-0.01em',
                    }}
                  >
                    Resumen de órdenes
                  </h3>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-5">
                  {[
                    { label: 'TOTAL', value: ordersStats.total, color: 'var(--sc-text-hi)' },
                    { label: 'PENDIENTES', value: ordersStats.pending, color: 'var(--sc-warn)' },
                    { label: 'EN PROCESO', value: ordersStats.processing, color: 'var(--sc-blue-600)' },
                    { label: 'COMPLETADAS', value: ordersStats.completed, color: 'var(--sc-ok)' },
                    { label: 'CANCELADAS', value: ordersStats.cancelled, color: 'var(--sc-err)' },
                  ].map((s, i) => (
                    <div
                      key={s.label}
                      className="text-center"
                      style={{
                        padding: 24,
                        borderRight: i < 4 ? '1px solid var(--sc-line-faint)' : undefined,
                      }}
                    >
                      <p
                        className="sc-mono"
                        style={{
                          fontSize: 28,
                          fontWeight: 600,
                          color: s.color,
                          fontFeatureSettings: '"tnum"',
                          letterSpacing: '-0.02em',
                        }}
                      >
                        {s.value}
                      </p>
                      <p
                        className="sc-mono"
                        style={{
                          fontSize: 10,
                          color: 'var(--sc-text-low)',
                          marginTop: 6,
                          letterSpacing: '0.18em',
                        }}
                      >
                        {s.label}
                      </p>
                    </div>
                  ))}
                </div>
              </Panel>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
