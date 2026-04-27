'use client'

import { useQuery } from '@tanstack/react-query'
import { Settings, Loader2, Building2, CreditCard } from 'lucide-react'
import api from '@/lib/api'
import { Header } from '@/components/layout/header'
import { useAuthStore } from '@/stores/auth.store'

export default function SettingsPage() {
  const { user } = useAuthStore()

  const { data: tenant, isLoading } = useQuery({
    queryKey: ['tenant'],
    queryFn: () => api.get('/tenants/me').then((r) => r.data),
  })

  const { data: usage } = useQuery({
    queryKey: ['tenant-usage'],
    queryFn: () => api.get('/tenants/me/usage').then((r) => r.data),
  })

  const planLimits: Record<string, { products: number; connections: number; users: number }> = {
    free: { products: 50, connections: 1, users: 1 },
    starter: { products: 500, connections: 2, users: 3 },
    pro: { products: 5000, connections: 5, users: 10 },
    business: { products: 25000, connections: 99, users: 25 },
    enterprise: { products: 999999, connections: 999, users: 999 },
  }

  const limits = planLimits[tenant?.plan || 'free']

  return (
    <div className="flex flex-col h-full">
      <Header title="Configuración" subtitle="Configuración de tu cuenta y plan" />

      <div className="flex-1 p-6 overflow-auto space-y-6 max-w-3xl">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
          </div>
        ) : (
          <>
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
              <div className="flex items-center gap-2 mb-4">
                <Building2 className="w-5 h-5 text-gray-500" />
                <h3 className="font-semibold text-gray-800">Información de la empresa</h3>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                {[
                  { label: 'Nombre', value: tenant?.name },
                  { label: 'Slug', value: tenant?.slug },
                  { label: 'Email', value: tenant?.email },
                  { label: 'País', value: tenant?.country },
                  { label: 'Moneda', value: tenant?.currency },
                  { label: 'Plan', value: <span className="capitalize font-semibold text-sky-600">{tenant?.plan}</span> },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-gray-500 text-xs mb-0.5">{label}</p>
                    <p className="font-medium text-gray-800">{value}</p>
                  </div>
                ))}
              </div>
            </div>

            {usage && limits && (
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
                <div className="flex items-center gap-2 mb-4">
                  <CreditCard className="w-5 h-5 text-gray-500" />
                  <h3 className="font-semibold text-gray-800">Uso del plan</h3>
                </div>
                <div className="space-y-4">
                  {[
                    { label: 'Productos', used: usage.products, limit: limits.products },
                    { label: 'Conexiones', used: usage.connections, limit: limits.connections },
                    { label: 'Usuarios', used: usage.users, limit: limits.users },
                  ].map(({ label, used, limit }) => {
                    const pct = Math.min((used / limit) * 100, 100)
                    return (
                      <div key={label}>
                        <div className="flex justify-between text-sm mb-1">
                          <span className="text-gray-600">{label}</span>
                          <span className="text-gray-500 font-medium">
                            {used} / {limit === 999999 ? '∞' : limit}
                          </span>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-amber-500' : 'bg-sky-500'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>

                {tenant?.plan !== 'enterprise' && (
                  <div className="mt-6 p-4 bg-sky-50 rounded-lg border border-sky-100">
                    <p className="text-sm text-sky-800 font-medium mb-1">¿Necesitas más capacidad?</p>
                    <p className="text-xs text-sky-600 mb-3">Actualiza tu plan para acceder a más productos, conexiones y usuarios.</p>
                    <button className="bg-sky-600 hover:bg-sky-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                      Ver planes disponibles
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
              <div className="flex items-center gap-2 mb-4">
                <Settings className="w-5 h-5 text-gray-500" />
                <h3 className="font-semibold text-gray-800">Mi perfil</h3>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                {[
                  { label: 'Nombre', value: `${user?.firstName} ${user?.lastName}` },
                  { label: 'Email', value: user?.email },
                  { label: 'Rol', value: <span className="capitalize">{user?.role}</span> },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-gray-500 text-xs mb-0.5">{label}</p>
                    <p className="font-medium text-gray-800">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
