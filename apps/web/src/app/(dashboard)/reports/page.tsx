'use client'

import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts'
import { BarChart3, Loader2 } from 'lucide-react'
import api from '@/lib/api'
import { Header } from '@/components/layout/header'
import { formatCurrency } from '@/lib/utils'

const COLORS = ['#0ea5e9', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#3b82f6']

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
        { name: 'Pendientes', value: ordersStats.pending, color: '#f59e0b' },
        { name: 'En proceso', value: ordersStats.processing, color: '#8b5cf6' },
        { name: 'Completadas', value: ordersStats.completed, color: '#10b981' },
        { name: 'Canceladas', value: ordersStats.cancelled, color: '#ef4444' },
      ].filter((d) => d.value > 0)
    : []

  return (
    <div className="flex flex-col h-full">
      <Header title="Reportes" subtitle="Análisis de ventas e inventario" />

      <div className="flex-1 p-6 overflow-auto space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { label: 'Revenue del mes', value: formatCurrency(dashboardData?.totalSales || 0), color: 'text-sky-600' },
                { label: 'Órdenes del mes', value: String(dashboardData?.totalOrders || 0), color: 'text-violet-600' },
                { label: 'Productos activos', value: String(dashboardData?.totalProducts || 0), color: 'text-emerald-600' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm">
                  <p className="text-sm text-gray-500 mb-1">{label}</p>
                  <p className={`text-2xl font-bold ${color}`}>{value}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm">
                <h3 className="font-semibold text-gray-800 mb-4">Ventas por canal</h3>
                {salesByChannel.length > 0 ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={salesByChannel}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="channel" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
                      <Tooltip formatter={(v: number) => formatCurrency(v)} />
                      <Bar dataKey="sales" fill="#0ea5e9" radius={[4, 4, 0, 0]} name="Ventas" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-48 text-gray-400">
                    <div className="text-center">
                      <BarChart3 className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                      <p className="text-sm">Sin datos de ventas aún</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-white rounded-xl p-6 border border-gray-100 shadow-sm">
                <h3 className="font-semibold text-gray-800 mb-4">Estado de órdenes</h3>
                {orderStatusData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie data={orderStatusData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={4}>
                        {orderStatusData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Legend />
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-48 text-gray-400">
                    <p className="text-sm">Sin órdenes registradas</p>
                  </div>
                )}
              </div>
            </div>

            {ordersStats && (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100">
                  <h3 className="font-semibold text-gray-800">Resumen de órdenes</h3>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-5 divide-x divide-y divide-gray-100">
                  {[
                    { label: 'Total', value: ordersStats.total, color: 'text-gray-800' },
                    { label: 'Pendientes', value: ordersStats.pending, color: 'text-yellow-600' },
                    { label: 'En proceso', value: ordersStats.processing, color: 'text-purple-600' },
                    { label: 'Completadas', value: ordersStats.completed, color: 'text-green-600' },
                    { label: 'Canceladas', value: ordersStats.cancelled, color: 'text-red-500' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="p-6 text-center">
                      <p className={`text-2xl font-bold ${color}`}>{value}</p>
                      <p className="text-xs text-gray-500 mt-1">{label}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
