'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Plug, Loader2, RefreshCw, Trash2, CheckCircle, XCircle,
  Clock, AlertTriangle, ChevronRight, ExternalLink, Zap, BarChart2, X,
  ShieldCheck, Globe, Key,
} from 'lucide-react'
import api from '@/lib/api'
import { Header } from '@/components/layout/header'
import { formatRelativeDate, CONNECTION_STATUS_LABELS, PROVIDER_LABELS } from '@/lib/utils'
import { toast } from 'sonner'

// ─── Provider metadata ────────────────────────────────────────────────────────

const PROVIDER_META: Record<string, {
  label: string
  type: 'ecommerce' | 'marketplace'
  color: string
  bg: string
  authType: 'oauth' | 'apikey' | 'basic'
  fields: CredentialField[]
  docs?: string
}> = {
  shopify: {
    label: 'Shopify', type: 'ecommerce', color: 'text-green-600', bg: 'bg-green-50',
    authType: 'oauth',
    fields: [
      { key: 'shopDomain', label: 'Dominio de la tienda', placeholder: 'mitienda.myshopify.com', hint: 'Sin https://' },
      { key: 'accessToken', label: 'Access Token', placeholder: 'shpat_...', secret: true, hint: 'Admin API access token' },
    ],
    docs: 'https://shopify.dev/docs/api/admin-rest',
  },
  woocommerce: {
    label: 'WooCommerce', type: 'ecommerce', color: 'text-purple-600', bg: 'bg-purple-50',
    authType: 'basic',
    fields: [
      { key: 'siteUrl', label: 'URL del sitio', placeholder: 'https://mitienda.com', hint: 'URL completa con https' },
      { key: 'consumerKey', label: 'Consumer Key', placeholder: 'ck_...', hint: 'WooCommerce → Ajustes → API' },
      { key: 'consumerSecret', label: 'Consumer Secret', placeholder: 'cs_...', secret: true },
    ],
    docs: 'https://woocommerce.github.io/woocommerce-rest-api-docs/',
  },
  jumpseller: {
    label: 'Jumpseller', type: 'ecommerce', color: 'text-blue-600', bg: 'bg-blue-50',
    authType: 'oauth',
    fields: [
      { key: 'login', label: 'Login (email)', placeholder: 'tu@correo.com' },
      { key: 'authToken', label: 'Auth Token', placeholder: 'xxxxxxxxxxxxxxxx', secret: true, hint: 'Jumpseller → Configuración → API' },
    ],
    docs: 'https://jumpseller.com/support/api-authentication/',
  },
  mercadolibre: {
    label: 'Mercado Libre', type: 'marketplace', color: 'text-yellow-600', bg: 'bg-yellow-50',
    authType: 'oauth_manual' as any,
    fields: [],
    docs: 'https://developers.mercadolibre.cl/es_ar/autenticacion-y-autorizacion',
  },
  falabella: {
    label: 'Falabella', type: 'marketplace', color: 'text-green-700', bg: 'bg-green-50',
    authType: 'apikey',
    fields: [
      { key: 'userId', label: 'User ID (tu email de Seller Center)', placeholder: 'seller@example.com', hint: 'Seller Center → Mi cuenta → Integraciones → User ID' },
      { key: 'apiKey', label: 'API Key', placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', secret: true, hint: 'Seller Center → Mi cuenta → Integraciones → API Key (no el secret)' },
    ],
    docs: 'https://developers.falabella.com/reference/getting-started',
  },
  walmart: {
    label: 'Walmart', type: 'marketplace', color: 'text-blue-700', bg: 'bg-blue-50',
    authType: 'apikey',
    fields: [
      { key: 'userId', label: 'User ID', placeholder: 'seller@walmart.com' },
      { key: 'apiSecret', label: 'API Secret', placeholder: 'xxxxxxxx', secret: true },
    ],
  },
  ripley: {
    label: 'Ripley', type: 'marketplace', color: 'text-red-600', bg: 'bg-red-50',
    authType: 'apikey',
    fields: [
      { key: 'userId', label: 'User ID', placeholder: 'seller@ripley.com' },
      { key: 'apiSecret', label: 'API Secret', placeholder: 'xxxxxxxx', secret: true },
    ],
  },
  paris: {
    label: 'Paris', type: 'marketplace', color: 'text-red-700', bg: 'bg-red-50',
    authType: 'apikey',
    fields: [
      { key: 'userId', label: 'User ID', placeholder: 'seller@paris.cl' },
      { key: 'apiSecret', label: 'API Secret', placeholder: 'xxxxxxxx', secret: true },
    ],
  },
}

interface CredentialField {
  key: string
  label: string
  placeholder?: string
  hint?: string
  secret?: boolean
}

// ─── Status helpers ───────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: string }) {
  if (status === 'connected') return <CheckCircle className="w-4 h-4 text-green-500" />
  if (status === 'error') return <XCircle className="w-4 h-4 text-red-500" />
  if (status === 'syncing') return <RefreshCw className="w-4 h-4 text-blue-500 animate-spin" />
  return <Clock className="w-4 h-4 text-gray-400" />
}

function ProviderIcon({ provider, size = 'md' }: { provider: string; size?: 'sm' | 'md' }) {
  const meta = PROVIDER_META[provider]
  const dim = size === 'sm' ? 'w-8 h-8 text-xs' : 'w-11 h-11 text-sm'
  return (
    <div className={`${dim} ${meta?.bg || 'bg-gray-100'} rounded-xl flex items-center justify-center font-bold ${meta?.color || 'text-gray-600'}`}>
      {(meta?.label || provider)[0]}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ConnectionsPage() {
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [statusPanel, setStatusPanel] = useState<string | null>(null)

  const { data: connections, isLoading } = useQuery({
    queryKey: ['connections'],
    queryFn: () => api.get('/connections').then((r) => r.data),
  })

  const syncMutation = useMutation({
    mutationFn: (id: string) => api.post(`/connections/${id}/sync`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connections'] })
      toast.success('Sincronización encolada')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Error al sincronizar'),
  })

  const testMutation = useMutation({
    mutationFn: (id: string) => api.post(`/connections/${id}/test`).then((r) => r.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['connections'] })
      if (data.success) toast.success(`Conexión verificada: ${data.shopName || 'OK'}`)
      else toast.error(`Falla: ${data.error}`)
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Error al probar'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/connections/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connections'] })
      toast.success('Conexión eliminada')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Error al eliminar'),
  })

  const ecommerce = connections?.filter((c: any) => c.type === 'ecommerce') || []
  const marketplaces = connections?.filter((c: any) => c.type === 'marketplace') || []

  return (
    <div className="flex h-full">
      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0">
        <Header title="Conexiones" subtitle="Gestiona tus plataformas y marketplaces" />

        <div className="flex-1 p-6 overflow-auto space-y-6">
          {/* Toolbar */}
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500">
              {connections?.length || 0} conexión{connections?.length !== 1 ? 'es' : ''} activa{connections?.length !== 1 ? 's' : ''}
            </p>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              Nueva conexión
            </button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
            </div>
          ) : (
            <>
              {ecommerce.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Tienda padre / E-commerce</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {ecommerce.map((conn: any) => (
                      <ConnectionCard
                        key={conn.id}
                        conn={conn}
                        syncing={syncMutation.isPending && syncMutation.variables === conn.id}
                        testing={testMutation.isPending && testMutation.variables === conn.id}
                        onSync={() => syncMutation.mutate(conn.id)}
                        onTest={() => testMutation.mutate(conn.id)}
                        onDelete={() => deleteMutation.mutate(conn.id)}
                        onStatus={() => setStatusPanel(statusPanel === conn.id ? null : conn.id)}
                        showStatus={statusPanel === conn.id}
                      />
                    ))}
                  </div>
                </section>
              )}

              {marketplaces.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Marketplaces</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {marketplaces.map((conn: any) => (
                      <ConnectionCard
                        key={conn.id}
                        conn={conn}
                        syncing={syncMutation.isPending && syncMutation.variables === conn.id}
                        testing={testMutation.isPending && testMutation.variables === conn.id}
                        onSync={() => syncMutation.mutate(conn.id)}
                        onTest={() => testMutation.mutate(conn.id)}
                        onDelete={() => deleteMutation.mutate(conn.id)}
                        onStatus={() => setStatusPanel(statusPanel === conn.id ? null : conn.id)}
                        showStatus={statusPanel === conn.id}
                      />
                    ))}
                  </div>
                </section>
              )}

              {connections?.length === 0 && (
                <EmptyState onAdd={() => setShowModal(true)} />
              )}
            </>
          )}
        </div>
      </div>

      {/* Status side panel */}
      {statusPanel && (
        <StatusSidePanel
          connectionId={statusPanel}
          onClose={() => setStatusPanel(null)}
        />
      )}

      {showModal && (
        <ConnectModal
          onClose={() => setShowModal(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['connections'] })
            setShowModal(false)
          }}
        />
      )}
    </div>
  )
}

// ─── Connection card ──────────────────────────────────────────────────────────

function ConnectionCard({
  conn, syncing, testing, onSync, onTest, onDelete, onStatus, showStatus,
}: {
  conn: any
  syncing: boolean
  testing: boolean
  onSync: () => void
  onTest: () => void
  onDelete: () => void
  onStatus: () => void
  showStatus: boolean
}) {
  const s = CONNECTION_STATUS_LABELS[conn.status] || CONNECTION_STATUS_LABELS.disconnected
  const meta = PROVIDER_META[conn.provider]
  const mappings = conn._count?.marketplaceMappings ?? 0

  return (
    <div className={`bg-white rounded-xl border transition-shadow hover:shadow-md ${showStatus ? 'border-sky-300 shadow-md' : 'border-gray-200'}`}>
      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <ProviderIcon provider={conn.provider} />
            <div>
              <h4 className="font-semibold text-gray-900 text-sm leading-tight">{conn.name}</h4>
              <p className="text-xs text-gray-400 mt-0.5">{meta?.label || conn.provider}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <StatusIcon status={conn.status} />
            <span className={`text-xs font-medium ${s.color}`}>{s.label}</span>
          </div>
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-3 text-xs text-gray-400 mb-4">
          {conn.lastSync && (
            <span>Sync: {formatRelativeDate(conn.lastSync)}</span>
          )}
          {mappings > 0 && (
            <span className="flex items-center gap-1">
              <BarChart2 className="w-3 h-3" />
              {mappings} producto{mappings !== 1 ? 's' : ''}
            </span>
          )}
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${meta?.authType === 'oauth' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
            {meta?.authType === 'oauth' ? 'OAuth' : meta?.authType === 'basic' ? 'Basic' : 'API Key'}
          </span>
        </div>

        {conn.lastError && (
          <div className="flex items-start gap-1.5 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-4">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span className="line-clamp-2">{conn.lastError}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={onSync}
            disabled={syncing}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-sky-50 hover:bg-sky-100 text-sky-700 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
            Sincronizar
          </button>
          <button
            onClick={onTest}
            disabled={testing}
            className="flex items-center justify-center p-2 bg-gray-50 hover:bg-gray-100 text-gray-500 hover:text-green-600 rounded-lg transition-colors disabled:opacity-50"
            title="Probar conexión"
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
          </button>
          <button
            onClick={onStatus}
            className={`flex items-center justify-center p-2 rounded-lg transition-colors ${showStatus ? 'bg-sky-100 text-sky-600' : 'bg-gray-50 hover:bg-gray-100 text-gray-500 hover:text-sky-600'}`}
            title="Ver estado y logs"
          >
            <BarChart2 className="w-4 h-4" />
          </button>
          <button
            onClick={onDelete}
            className="flex items-center justify-center p-2 bg-gray-50 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded-lg transition-colors"
            title="Eliminar conexión"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Status side panel ────────────────────────────────────────────────────────

function StatusSidePanel({ connectionId, onClose }: { connectionId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['connection-status', connectionId],
    queryFn: () => api.get(`/connections/${connectionId}/status`).then((r) => r.data),
    refetchInterval: 10000,
  })

  const statusColors: Record<string, string> = {
    success: 'text-green-600 bg-green-50',
    error: 'text-red-600 bg-red-50',
    pending: 'text-yellow-600 bg-yellow-50',
  }

  return (
    <div className="w-80 border-l border-gray-200 bg-white flex flex-col">
      <div className="p-4 border-b border-gray-100 flex items-center justify-between">
        <h3 className="font-semibold text-gray-800 text-sm">Estado de sincronización</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X className="w-4 h-4" />
        </button>
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-sky-500" />
        </div>
      ) : data ? (
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {/* Mappings */}
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Productos sincronizados</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Sync', value: data.mappings?.synced ?? 0, color: 'text-green-600' },
                { label: 'Error', value: data.mappings?.error ?? 0, color: 'text-red-600' },
                { label: 'Pendiente', value: data.mappings?.pending ?? 0, color: 'text-yellow-600' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-gray-50 rounded-lg p-2 text-center">
                  <div className={`text-lg font-bold ${color}`}>{value}</div>
                  <div className="text-[10px] text-gray-400">{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Last sync */}
          {data.lastSync && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase mb-1">Última sincronización</p>
              <p className="text-sm text-gray-600">{new Date(data.lastSync).toLocaleString('es-CL')}</p>
            </div>
          )}

          {/* Last error */}
          {data.lastError && (
            <div className="bg-red-50 rounded-lg p-3">
              <p className="text-xs font-semibold text-red-600 mb-1">Último error</p>
              <p className="text-xs text-red-700">{data.lastError}</p>
            </div>
          )}

          {/* Recent logs */}
          {data.recentLogs?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase mb-2">Historial reciente</p>
              <div className="space-y-2">
                {data.recentLogs.map((log: any) => (
                  <div key={log.id} className="flex items-start gap-2 text-xs">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${statusColors[log.status] || 'text-gray-600 bg-gray-100'}`}>
                      {log.status}
                    </span>
                    <div className="min-w-0">
                      <p className="text-gray-700 font-medium">{log.action}</p>
                      <p className="text-gray-400">{formatRelativeDate(log.createdAt)}</p>
                      {log.errorMessage && <p className="text-red-500 truncate">{log.errorMessage}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 py-20 text-center">
      <Plug className="w-14 h-14 text-gray-300 mx-auto mb-4" />
      <h3 className="text-lg font-semibold text-gray-700 mb-2">Sin conexiones aún</h3>
      <p className="text-gray-400 text-sm mb-6 max-w-sm mx-auto">
        Conecta tu tienda y marketplaces para comenzar a sincronizar productos y órdenes automáticamente.
      </p>
      <button onClick={onAdd} className="bg-sky-600 hover:bg-sky-700 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors">
        Conectar primera plataforma
      </button>
    </div>
  )
}

// ─── Connect modal ────────────────────────────────────────────────────────────

type Step = 'select' | 'configure' | 'oauth_ml'

function ConnectModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [step, setStep] = useState<Step>('select')
  const [provider, setProvider] = useState<string | null>(null)
  const [credentials, setCredentials] = useState<Record<string, string>>({})
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)

  const meta = provider ? PROVIDER_META[provider] : null

  const setField = (key: string, value: string) =>
    setCredentials((prev) => ({ ...prev, [key]: value }))

  const handleSelect = (p: string) => {
    setProvider(p)
    setCredentials({})
    setName(PROVIDER_META[p]?.label || p)
    setStep(p === 'mercadolibre' ? 'oauth_ml' : 'configure')
  }

  const handleConnect = async () => {
    if (!provider || !meta) return
    setLoading(true)
    try {
      await api.post('/connections', {
        provider,
        name: name || meta.label,
        credentials,
      })
      toast.success(`${meta.label} conectado correctamente`)
      onSuccess()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Credenciales inválidas — verifica los datos')
    } finally {
      setLoading(false)
    }
  }

  const canSubmit = meta?.fields.every((f) => !f.secret ? true : credentials[f.key]?.trim())

  const stepTitle: Record<Step, string> = {
    select: 'Nueva conexión',
    configure: `Configurar ${meta?.label || ''}`,
    oauth_ml: 'Conectar Mercado Libre',
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-6 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            {step !== 'select' && (
              <button onClick={() => setStep('select')} className="text-gray-400 hover:text-gray-600 mr-1">
                <ChevronRight className="w-5 h-5 rotate-180" />
              </button>
            )}
            {step !== 'select' && provider && <ProviderIcon provider={provider} size="sm" />}
            <div>
              <h2 className="text-base font-semibold text-gray-900">{stepTitle[step]}</h2>
              {step === 'select' && <p className="text-xs text-gray-400 mt-0.5">Selecciona la plataforma a conectar</p>}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1">
          {step === 'select' && <ProviderGrid onSelect={handleSelect} />}
          {step === 'configure' && (
            <CredentialsForm
              provider={provider!}
              meta={meta!}
              name={name}
              credentials={credentials}
              onNameChange={setName}
              onFieldChange={setField}
            />
          )}
          {step === 'oauth_ml' && (
            <MLOAuthFlow
              onSuccess={onSuccess}
              onBack={() => setStep('select')}
            />
          )}
        </div>

        {/* Footer — only for standard credential flow */}
        {step === 'configure' && (
          <div className="p-6 border-t border-gray-100 flex-shrink-0">
            {meta?.docs && (
              <a href={meta.docs} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-sky-600 mb-4 transition-colors">
                <ExternalLink className="w-3 h-3" />
                Ver documentación de {meta.label}
              </a>
            )}
            <div className="flex gap-3">
              <button onClick={() => setStep('select')}
                className="px-4 py-2.5 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition-colors">
                Atrás
              </button>
              <button onClick={handleConnect} disabled={loading || !canSubmit}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-sky-600 hover:bg-sky-700 disabled:bg-sky-300 text-white rounded-lg text-sm font-medium transition-colors">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                {loading ? 'Verificando credenciales…' : 'Conectar y verificar'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── ML OAuth manual flow ─────────────────────────────────────────────────────

function MLOAuthFlow({ onSuccess, onBack }: { onSuccess: () => void; onBack: () => void }) {
  const [mlStep, setMlStep] = useState<'credentials' | 'authorize' | 'code'>('credentials')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [authUrl, setAuthUrl] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)

  const handleGetUrl = async () => {
    if (!clientId.trim() || !clientSecret.trim()) {
      toast.error('Ingresa el App ID y Secret Key')
      return
    }
    setLoading(true)
    try {
      const res = await api.post('/connections/oauth/mercadolibre/init', {
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
      })
      setAuthUrl(res.data.url)
      setMlStep('authorize')
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Error al generar URL de autorización')
    } finally {
      setLoading(false)
    }
  }

  const handleExchange = async () => {
    const rawCode = code.trim()
    if (!rawCode) { toast.error('Pega el código de autorización'); return }
    setLoading(true)
    try {
      await api.post('/connections/oauth/mercadolibre/exchange', {
        code: rawCode,
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
      })
      toast.success('Mercado Libre conectado correctamente')
      onSuccess()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Código inválido o expirado — genera uno nuevo')
    } finally {
      setLoading(false)
    }
  }

  const extractCodeFromUrl = (val: string) => {
    try {
      const u = new URL(val)
      const c = u.searchParams.get('code')
      if (c) { setCode(c); toast.success('Código extraído de la URL') }
      else setCode(val)
    } catch {
      setCode(val)
    }
  }

  return (
    <div className="p-6 space-y-5">
      {/* Step 1 — App credentials */}
      <div className={`rounded-xl border p-4 space-y-3 transition-opacity ${mlStep !== 'credentials' ? 'opacity-60' : ''}`}>
        <div className="flex items-center gap-2">
          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${mlStep === 'credentials' ? 'bg-sky-600 text-white' : 'bg-green-500 text-white'}`}>
            {mlStep === 'credentials' ? '1' : '✓'}
          </span>
          <p className="text-sm font-semibold text-gray-800">Credenciales de tu app en ML</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">App ID <span className="text-gray-400 font-normal">(Client ID)</span></label>
          <input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            disabled={mlStep !== 'credentials'}
            placeholder="Ej: 1505665045196548"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:bg-gray-50"
          />
          <p className="text-xs text-gray-400 mt-1">Encuéntralo en developers.mercadolibre.cl → Tu app → App ID</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Secret Key <span className="text-gray-400 font-normal">(Client Secret)</span></label>
          <input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            disabled={mlStep !== 'credentials'}
            placeholder="Ej: ACL4bXCIAw7KSARA..."
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:bg-gray-50"
          />
          <p className="text-xs text-gray-400 mt-1">Mismo panel — Secret Key. Nunca lo compartas.</p>
        </div>
        {mlStep === 'credentials' && (
          <button onClick={handleGetUrl} disabled={loading || !clientId.trim() || !clientSecret.trim()}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-sky-600 hover:bg-sky-700 disabled:bg-sky-300 text-white rounded-lg text-sm font-medium transition-colors">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
            Generar enlace de autorización
          </button>
        )}
      </div>

      {/* Step 2 — Authorize */}
      {(mlStep === 'authorize' || mlStep === 'code') && (
        <div className={`rounded-xl border p-4 space-y-3 transition-opacity ${mlStep === 'code' ? 'opacity-60' : ''}`}>
          <div className="flex items-center gap-2">
            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${mlStep === 'authorize' ? 'bg-sky-600 text-white' : 'bg-green-500 text-white'}`}>
              {mlStep === 'authorize' ? '2' : '✓'}
            </span>
            <p className="text-sm font-semibold text-gray-800">Autorizar en Mercado Libre</p>
          </div>
          <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 text-xs text-amber-700 space-y-1">
            <p>1. Haz clic en el botón de abajo para abrir ML en una nueva pestaña.</p>
            <p>2. Inicia sesión con tu cuenta de vendedor y acepta los permisos.</p>
            <p>3. ML redirigirá a una página que no existe — <strong>eso es normal</strong>. Copia toda la URL de esa página.</p>
            <p>4. Pega la URL (o solo el código) en el paso siguiente.</p>
          </div>
          <a href={authUrl} target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-yellow-400 hover:bg-yellow-500 text-yellow-900 rounded-lg text-sm font-semibold transition-colors">
            <ExternalLink className="w-4 h-4" />
            Abrir Mercado Libre para autorizar
          </a>
          {mlStep === 'authorize' && (
            <button onClick={() => setMlStep('code')}
              className="w-full px-4 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition-colors">
              Ya autoricé — continuar
            </button>
          )}
        </div>
      )}

      {/* Step 3 — Paste code */}
      {mlStep === 'code' && (
        <div className="rounded-xl border border-sky-200 bg-sky-50/30 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-sky-600 text-white flex items-center justify-center text-xs font-bold flex-shrink-0">3</span>
            <p className="text-sm font-semibold text-gray-800">Pega la URL de redirección</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">URL completa o código de autorización</label>
            <textarea
              value={code}
              onChange={(e) => extractCodeFromUrl(e.target.value)}
              rows={3}
              placeholder={"https://stockcentral.app/api/v1/connections/oauth/mercadolibre/callback?code=TG-XXXXX...\n\nO solo el código: TG-68371890234..."}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none"
            />
            <p className="text-xs text-gray-400 mt-1">Pega la URL completa — StockCentral extrae el código automáticamente. El código expira en 10 minutos.</p>
          </div>
          <button onClick={handleExchange} disabled={loading || !code.trim()}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-sky-600 hover:bg-sky-700 disabled:bg-sky-300 text-white rounded-lg text-sm font-medium transition-colors">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {loading ? 'Conectando con Mercado Libre…' : 'Completar conexión'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Provider grid ────────────────────────────────────────────────────────────

function ProviderGrid({ onSelect }: { onSelect: (p: string) => void }) {
  const ecommerceProviders = Object.entries(PROVIDER_META).filter(([, m]) => m.type === 'ecommerce')
  const marketplaceProviders = Object.entries(PROVIDER_META).filter(([, m]) => m.type === 'marketplace')

  return (
    <div className="p-6 space-y-5">
      <ProviderSection title="Tiendas / E-commerce" providers={ecommerceProviders} onSelect={onSelect} />
      <ProviderSection title="Marketplaces" providers={marketplaceProviders} onSelect={onSelect} />
    </div>
  )
}

function ProviderSection({
  title, providers, onSelect,
}: {
  title: string
  providers: [string, typeof PROVIDER_META[string]][]
  onSelect: (p: string) => void
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{title}</p>
      <div className="grid grid-cols-2 gap-2.5">
        {providers.map(([key, meta]) => (
          <button
            key={key}
            onClick={() => onSelect(key)}
            className="flex items-center gap-3 p-3.5 border border-gray-200 rounded-xl hover:border-sky-300 hover:bg-sky-50 transition-all text-left group"
          >
            <div className={`w-9 h-9 ${meta.bg} rounded-lg flex items-center justify-center text-sm font-bold ${meta.color} flex-shrink-0`}>
              {meta.label[0]}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-800 group-hover:text-sky-700">{meta.label}</p>
              <p className="text-[10px] text-gray-400 flex items-center gap-1 mt-0.5">
                {meta.authType === 'oauth' ? <><Key className="w-2.5 h-2.5" />OAuth</> : meta.authType === 'basic' ? <><Globe className="w-2.5 h-2.5" />Basic Auth</> : <><Key className="w-2.5 h-2.5" />API Key</>}
              </p>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-sky-400 ml-auto" />
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Credentials form ─────────────────────────────────────────────────────────

function CredentialsForm({
  provider, meta, name, credentials, onNameChange, onFieldChange,
}: {
  provider: string
  meta: typeof PROVIDER_META[string]
  name: string
  credentials: Record<string, string>
  onNameChange: (v: string) => void
  onFieldChange: (key: string, value: string) => void
}) {
  return (
    <div className="p-6 space-y-4">
      {/* Auth type badge */}
      <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${meta.authType === 'oauth' ? 'bg-blue-50 text-blue-700' : 'bg-gray-50 text-gray-600'}`}>
        <ShieldCheck className="w-3.5 h-3.5" />
        {meta.authType === 'oauth'
          ? 'Autenticación OAuth 2.0 — tus credenciales viajan cifradas'
          : meta.authType === 'basic'
          ? 'Autenticación Basic — consumer key + secret'
          : 'Autenticación por API Key'}
      </div>

      {/* Connection name */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Nombre de la conexión</label>
        <input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={meta.label}
          className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
        />
      </div>

      {/* Dynamic credential fields */}
      {meta.fields.map((field) => (
        <div key={field.key}>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">{field.label}</label>
          <input
            type={field.secret ? 'password' : 'text'}
            value={credentials[field.key] || ''}
            onChange={(e) => onFieldChange(field.key, e.target.value)}
            placeholder={field.placeholder}
            autoComplete={field.secret ? 'new-password' : 'off'}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent font-mono"
          />
          {field.hint && (
            <p className="text-xs text-gray-400 mt-1">{field.hint}</p>
          )}
        </div>
      ))}

      {/* Tip box */}
      <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 text-xs text-amber-700 flex items-start gap-2">
        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
        Al hacer clic en "Conectar y verificar" se probarán las credenciales contra la API real de {meta.label} antes de guardarlas.
      </div>
    </div>
  )
}
