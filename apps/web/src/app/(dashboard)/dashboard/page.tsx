'use client'

import { useQuery } from '@tanstack/react-query'
import {
  TrendingUp, TrendingDown, ShoppingCart, Package, Plug, DollarSign,
  AlertTriangle, CheckCircle2, Loader2, RefreshCw,
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar
} from 'recharts'
import api from '@/lib/api'
import { Header } from '@/components/layout/header'
import { formatCurrency, formatRelativeDate, ORDER_STATUS_LABELS, CONNECTION_STATUS_LABELS, PROVIDER_LABELS } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'

function StatCard({
  title, value, change, icon: Icon, color,
}: {
  title: string; value: string; change?: number; icon: any; color: string
}) {
  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500 font-medium">{title}</p>
        <div className={`p-2 rounded-lg ${color}`}>
          <Icon className="w-4 h-4 text-white" />
        </div>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      {change !== undefined && (
        <div className="flex items-center gap-1 mt-2">
          {change >= 0 ? (
            <TrendingUp className="w-3 h-3 text-green-500" />
          ) : (
            <TrendingDown className="w-3 h-3 text-red-500" />
          )}
          <span className={`text-xs font-medium ${change >= 0 ? 'text-green-600' : 'text-red-500'}`}>
            {change >= 0 ? '+' : ''}{change.toFixed(1)}% vs mes anterior
          </span>
        </div>
      )}
    </div>
  )
}

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

  return (
    <div className="flex flex-col h-full">
      <Header
        title={`Bienvenido, ${user?.firstName || 'Usuario'}`}
        subtitle="Resumen de tu negocio este mes"
      />

      <div className="flex-1 p-6 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <StatCard
                title="Ventas del mes"
                value={formatCurrency(stats.totalSales || 0, user?.tenant?.currency || 'CLP')}
                change={stats.salesChange}
                icon={DollarSign}
                color="bg-sky-500"
              />
              <StatCard
                title="Órdenes"
                value={String(stats.totalOrders || 0)}
                change={stats.ordersChange}
                icon={ShoppingCart}
                color="bg-violet-500"
              />
              <StatCard
                title="Productos activos"
                value={String(stats.totalProducts || 0)}
                icon={Package}
                color="bg-emerald-500"
              />
              <StatCard
                title="Conexiones activas"
                value={String(stats.totalConnections || 0)}
                icon={Plug}
                color="bg-amber-500"
              />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              <div className="xl:col-span-2 bg-white rounded-xl p-6 shadow-sm border border-gray-100">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="font-semibold text-gray-800">Ventas por día (últimos 7 días)</h3>
                  <button onClick={() => refetch()} className="p-1.5 text-gray-400 hover:text-gray-600 rounded">
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={stats.salesByChannel?.length ? stats.salesByChannel : sampleSalesData}>
                    <defs>
                      <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
                    <Tooltip formatter={(v: number) => formatCurrency(v)} />
                    <Area type="monotone" dataKey="ventas" stroke="#0ea5e9" fill="url(#salesGrad)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
                <h3 className="font-semibold text-gray-800 mb-4">Estado de conexiones</h3>
                {stats.connectionStatus?.length > 0 ? (
                  <div className="space-y-3">
                    {stats.connectionStatus.map((conn: any) => {
                      const s = CONNECTION_STATUS_LABELS[conn.status] || CONNECTION_STATUS_LABELS.disconnected
                      return (
                        <div key={conn.id} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${s.dot}`} />
                            <span className="text-sm text-gray-700">{PROVIDER_LABELS[conn.provider] || conn.name}</span>
                          </div>
                          <span className={`text-xs font-medium ${s.color}`}>{s.label}</span>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Plug className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-gray-400">Sin conexiones aún</p>
                    <a href="/connections" className="text-sky-600 text-xs hover:underline mt-1 inline-block">
                      Conectar plataforma
                    </a>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                <h3 className="font-semibold text-gray-800">Órdenes recientes</h3>
                <a href="/orders" className="text-sky-600 text-sm hover:underline">Ver todas</a>
              </div>
              {stats.recentOrders?.length > 0 ? (
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      {['#Orden', 'Cliente', 'Canal', 'Total', 'Estado', 'Fecha'].map((h) => (
                        <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {stats.recentOrders.map((order: any) => {
                      const statusInfo = ORDER_STATUS_LABELS[order.status] || { label: order.status, color: 'bg-gray-100 text-gray-600' }
                      return (
                        <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4 text-sm font-medium text-sky-600">{order.orderNumber}</td>
                          <td className="px-6 py-4 text-sm text-gray-600">{order.customerName}</td>
                          <td className="px-6 py-4 text-sm text-gray-500 capitalize">{PROVIDER_LABELS[order.sourceChannel] || order.sourceChannel}</td>
                          <td className="px-6 py-4 text-sm font-medium text-gray-800">{formatCurrency(Number(order.total))}</td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusInfo.color}`}>
                              {statusInfo.label}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-xs text-gray-400">{formatRelativeDate(order.createdAt)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="text-center py-12">
                  <ShoppingCart className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500">No hay órdenes aún</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
