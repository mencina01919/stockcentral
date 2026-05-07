'use client'

import { useQuery } from '@tanstack/react-query'
import { Settings, Loader2, Building2, CreditCard } from 'lucide-react'
import api from '@/lib/api'
import { Header } from '@/components/layout/header'
import { Panel, MonoLabel, ProgressBar, Chip } from '@/components/sc/ui'
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
  const userInitials = `${user?.firstName?.[0] || ''}${user?.lastName?.[0] || ''}`.toUpperCase()

  return (
    <div className="flex flex-col h-full">
      <Header
        breadcrumbs={['CONSOLA', 'CONFIGURACIÓN']}
        title="Configuración"
        subtitle="Ajusta tu cuenta, equipo y preferencias"
      />

      <div className="flex-1 px-7 py-6 overflow-auto">
        <div className="max-w-3xl space-y-5">
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--sc-blue-500)' }} />
            </div>
          ) : (
            <>
              {/* Profile preview */}
              <Panel style={{ padding: 28 }}>
                <MonoLabel tone="blue">// ACCOUNT.PROFILE</MonoLabel>
                <h3
                  className="mt-1 mb-5"
                  style={{ fontSize: 20, fontWeight: 600, color: 'var(--sc-text-hi)', letterSpacing: '-0.01em' }}
                >
                  Perfil de la cuenta
                </h3>

                <div
                  className="flex items-center gap-5"
                  style={{
                    padding: 18,
                    background: '#f7f9fd',
                    borderRadius: 10,
                    border: '1px solid var(--sc-line-faint)',
                  }}
                >
                  <div
                    className="flex items-center justify-center text-white sc-mono flex-shrink-0"
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, #3b82f6, #1e3a8a)',
                      fontSize: 22,
                      fontWeight: 700,
                    }}
                  >
                    {userInitials || 'SC'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--sc-text-hi)' }}>
                      {user?.firstName} {user?.lastName}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--sc-text-mid)', marginTop: 2 }}>
                      {user?.email}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <Chip tone="blue">{user?.role?.toUpperCase() || 'USER'}</Chip>
                    </div>
                  </div>
                </div>
              </Panel>

              {/* Company */}
              <Panel style={{ padding: 28 }}>
                <div className="flex items-center gap-2 mb-5">
                  <Building2 className="w-4 h-4" style={{ color: 'var(--sc-blue-600)' }} />
                  <MonoLabel tone="blue">// COMPANY.INFO</MonoLabel>
                </div>
                <h3
                  className="mb-5"
                  style={{ fontSize: 18, fontWeight: 600, color: 'var(--sc-text-hi)', letterSpacing: '-0.01em' }}
                >
                  Información de la empresa
                </h3>
                <div className="grid grid-cols-2 gap-5">
                  {[
                    { label: 'NOMBRE', value: tenant?.name },
                    { label: 'SLUG', value: tenant?.slug },
                    { label: 'EMAIL', value: tenant?.email },
                    { label: 'PAÍS', value: tenant?.country },
                    { label: 'MONEDA', value: tenant?.currency },
                    {
                      label: 'PLAN',
                      value: <Chip tone="blue">{(tenant?.plan || 'free').toUpperCase()}</Chip>,
                    },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <MonoLabel>{label}</MonoLabel>
                      <p
                        className="mt-1.5"
                        style={{ fontSize: 14, fontWeight: 500, color: 'var(--sc-text-hi)' }}
                      >
                        {value || '—'}
                      </p>
                    </div>
                  ))}
                </div>
              </Panel>

              {/* Plan usage */}
              {usage && limits && (
                <Panel style={{ padding: 28 }}>
                  <div className="flex items-center gap-2 mb-5">
                    <CreditCard className="w-4 h-4" style={{ color: 'var(--sc-blue-600)' }} />
                    <MonoLabel tone="blue">// PLAN.USAGE</MonoLabel>
                  </div>
                  <h3
                    className="mb-5"
                    style={{ fontSize: 18, fontWeight: 600, color: 'var(--sc-text-hi)', letterSpacing: '-0.01em' }}
                  >
                    Uso del plan
                  </h3>
                  <div className="space-y-5">
                    {[
                      { label: 'Productos', used: usage.products, limit: limits.products },
                      { label: 'Conexiones', used: usage.connections, limit: limits.connections },
                      { label: 'Usuarios', used: usage.users, limit: limits.users },
                    ].map(({ label, used, limit }) => {
                      const pct = Math.min((used / limit) * 100, 100)
                      const tone = pct > 90 ? 'err' : pct > 70 ? 'warn' : 'blue'
                      return (
                        <div key={label}>
                          <div className="flex justify-between mb-2" style={{ fontSize: 13 }}>
                            <span style={{ color: 'var(--sc-text-hi)', fontWeight: 500 }}>{label}</span>
                            <span
                              className="sc-mono"
                              style={{ color: 'var(--sc-text-low)' }}
                            >
                              {used} / {limit === 999999 ? '∞' : limit}
                            </span>
                          </div>
                          <ProgressBar value={pct} tone={tone} />
                        </div>
                      )
                    })}
                  </div>

                  {tenant?.plan !== 'enterprise' && (
                    <div
                      className="mt-6"
                      style={{
                        padding: 16,
                        background: 'rgba(59,130,246,0.06)',
                        border: '1px solid rgba(59,130,246,0.20)',
                        borderRadius: 10,
                      }}
                    >
                      <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--sc-blue-700)', marginBottom: 4 }}>
                        ¿Necesitas más capacidad?
                      </p>
                      <p style={{ fontSize: 12, color: 'var(--sc-text-mid)', marginBottom: 12 }}>
                        Actualiza tu plan para acceder a más productos, conexiones y usuarios.
                      </p>
                      <button className="sc-btn-primary" style={{ padding: '8px 14px', fontSize: 12 }}>
                        Ver planes disponibles
                      </button>
                    </div>
                  )}
                </Panel>
              )}

              <Panel style={{ padding: 28 }}>
                <div className="flex items-center gap-2 mb-5">
                  <Settings className="w-4 h-4" style={{ color: 'var(--sc-blue-600)' }} />
                  <MonoLabel tone="blue">// USER.PROFILE</MonoLabel>
                </div>
                <h3
                  className="mb-5"
                  style={{ fontSize: 18, fontWeight: 600, color: 'var(--sc-text-hi)', letterSpacing: '-0.01em' }}
                >
                  Mi perfil
                </h3>
                <div className="grid grid-cols-2 gap-5">
                  {[
                    { label: 'NOMBRE', value: `${user?.firstName} ${user?.lastName}` },
                    { label: 'EMAIL', value: user?.email },
                    { label: 'ROL', value: user?.role },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <MonoLabel>{label}</MonoLabel>
                      <p
                        className="mt-1.5"
                        style={{ fontSize: 14, fontWeight: 500, color: 'var(--sc-text-hi)' }}
                      >
                        {value || '—'}
                      </p>
                    </div>
                  ))}
                </div>
              </Panel>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
