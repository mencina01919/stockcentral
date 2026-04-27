'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Plug, Loader2, RefreshCw, Trash2, CheckCircle, XCircle, Clock } from 'lucide-react'
import api from '@/lib/api'
import { Header } from '@/components/layout/header'
import { formatRelativeDate, CONNECTION_STATUS_LABELS, PROVIDER_LABELS } from '@/lib/utils'
import { toast } from 'sonner'

const PROVIDERS = [
  { value: 'shopify', label: 'Shopify', type: 'ecommerce', color: 'bg-green-500' },
  { value: 'woocommerce', label: 'WooCommerce', type: 'ecommerce', color: 'bg-purple-500' },
  { value: 'jumpseller', label: 'Jumpseller', type: 'ecommerce', color: 'bg-blue-500' },
  { value: 'mercadolibre', label: 'Mercado Libre', type: 'marketplace', color: 'bg-yellow-500' },
  { value: 'falabella', label: 'Falabella', type: 'marketplace', color: 'bg-green-600' },
  { value: 'walmart', label: 'Walmart', type: 'marketplace', color: 'bg-blue-600' },
  { value: 'ripley', label: 'Ripley', type: 'marketplace', color: 'bg-red-500' },
  { value: 'paris', label: 'Paris', type: 'marketplace', color: 'bg-red-600' },
]

function StatusIcon({ status }: { status: string }) {
  if (status === 'connected') return <CheckCircle className="w-4 h-4 text-green-500" />
  if (status === 'error') return <XCircle className="w-4 h-4 text-red-500" />
  if (status === 'syncing') return <RefreshCw className="w-4 h-4 text-blue-500 animate-spin" />
  return <Clock className="w-4 h-4 text-gray-400" />
}

export default function ConnectionsPage() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)

  const { data: connections, isLoading } = useQuery({
    queryKey: ['connections'],
    queryFn: () => api.get('/connections').then((r) => r.data),
  })

  const syncMutation = useMutation({
    mutationFn: (id: string) => api.post(`/connections/${id}/sync`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connections'] })
      toast.success('Sincronización iniciada')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/connections/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connections'] })
      toast.success('Conexión eliminada')
    },
  })

  const ecommerceConnections = connections?.filter((c: any) => c.type === 'ecommerce') || []
  const marketplaceConnections = connections?.filter((c: any) => c.type === 'marketplace') || []

  return (
    <div className="flex flex-col h-full">
      <Header title="Conexiones" subtitle="Gestiona tus plataformas y marketplaces" />

      <div className="flex-1 p-6 overflow-auto space-y-6">
        <div className="flex justify-between items-center">
          <div className="text-sm text-gray-500">
            {connections?.length || 0} conexiones activas
          </div>
          <button
            onClick={() => setShowForm(true)}
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
            {ecommerceConnections.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Tienda padre</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {ecommerceConnections.map((conn: any) => (
                    <ConnectionCard key={conn.id} conn={conn} onSync={() => syncMutation.mutate(conn.id)} onDelete={() => deleteMutation.mutate(conn.id)} />
                  ))}
                </div>
              </section>
            )}

            {marketplaceConnections.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Marketplaces</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {marketplaceConnections.map((conn: any) => (
                    <ConnectionCard key={conn.id} conn={conn} onSync={() => syncMutation.mutate(conn.id)} onDelete={() => deleteMutation.mutate(conn.id)} />
                  ))}
                </div>
              </section>
            )}

            {connections?.length === 0 && (
              <div className="bg-white rounded-xl border border-gray-200 py-20 text-center">
                <Plug className="w-14 h-14 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-700 mb-2">Sin conexiones aún</h3>
                <p className="text-gray-400 text-sm mb-6 max-w-sm mx-auto">
                  Conecta tu tienda y marketplaces para comenzar a sincronizar productos y órdenes.
                </p>
                <button onClick={() => setShowForm(true)} className="bg-sky-600 hover:bg-sky-700 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors">
                  Conectar primera plataforma
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {showForm && <ConnectModal onClose={() => setShowForm(false)} onSuccess={() => {
        queryClient.invalidateQueries({ queryKey: ['connections'] })
        setShowForm(false)
      }} />}
    </div>
  )
}

function ConnectionCard({ conn, onSync, onDelete }: { conn: any; onSync: () => void; onDelete: () => void }) {
  const s = CONNECTION_STATUS_LABELS[conn.status] || CONNECTION_STATUS_LABELS.disconnected

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center text-lg font-bold text-gray-600">
            {(PROVIDER_LABELS[conn.provider] || conn.name)[0]}
          </div>
          <div>
            <h4 className="font-medium text-gray-900 text-sm">{conn.name}</h4>
            <p className="text-xs text-gray-400">{PROVIDER_LABELS[conn.provider] || conn.provider}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <StatusIcon status={conn.status} />
          <span className={`text-xs font-medium ${s.color}`}>{s.label}</span>
        </div>
      </div>

      {conn.lastSync && (
        <p className="text-xs text-gray-400 mb-3">
          Última sync: {formatRelativeDate(conn.lastSync)}
        </p>
      )}

      {conn.lastError && (
        <p className="text-xs text-red-500 bg-red-50 rounded px-2 py-1 mb-3">
          {conn.lastError}
        </p>
      )}

      <div className="flex gap-2">
        <button
          onClick={onSync}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-sky-50 hover:bg-sky-100 text-sky-600 rounded-lg text-xs font-medium transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          Sincronizar
        </button>
        <button
          onClick={onDelete}
          className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

function ConnectModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [step, setStep] = useState<'select' | 'configure'>('select')
  const [selected, setSelected] = useState<typeof PROVIDERS[0] | null>(null)
  const [name, setName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [shopUrl, setShopUrl] = useState('')
  const [loading, setLoading] = useState(false)

  const handleConnect = async () => {
    if (!selected) return
    setLoading(true)
    try {
      await api.post('/connections', {
        type: selected.type,
        provider: selected.value,
        name: name || selected.label,
        credentials: { apiKey, shopUrl },
      })
      toast.success(`${selected.label} conectado correctamente`)
      onSuccess()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Error al conectar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            {step === 'select' ? 'Selecciona una plataforma' : `Configurar ${selected?.label}`}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        {step === 'select' ? (
          <div className="p-6">
            <p className="text-sm text-gray-500 mb-4">Tiendas</p>
            <div className="grid grid-cols-2 gap-3 mb-6">
              {PROVIDERS.filter(p => p.type === 'ecommerce').map((p) => (
                <button key={p.value} onClick={() => { setSelected(p); setStep('configure') }}
                  className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:border-sky-300 hover:bg-sky-50 transition-colors text-left">
                  <div className={`w-8 h-8 ${p.color} rounded-lg flex items-center justify-center text-white text-xs font-bold`}>{p.label[0]}</div>
                  <span className="text-sm font-medium text-gray-700">{p.label}</span>
                </button>
              ))}
            </div>
            <p className="text-sm text-gray-500 mb-4">Marketplaces</p>
            <div className="grid grid-cols-2 gap-3">
              {PROVIDERS.filter(p => p.type === 'marketplace').map((p) => (
                <button key={p.value} onClick={() => { setSelected(p); setStep('configure') }}
                  className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:border-sky-300 hover:bg-sky-50 transition-colors text-left">
                  <div className={`w-8 h-8 ${p.color} rounded-lg flex items-center justify-center text-white text-xs font-bold`}>{p.label[0]}</div>
                  <span className="text-sm font-medium text-gray-700">{p.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre de la conexión</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder={selected?.label} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
            </div>
            {selected?.type === 'ecommerce' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">URL de la tienda</label>
                <input value={shopUrl} onChange={e => setShopUrl(e.target.value)} placeholder="mitienda.myshopify.com" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">API Key / Token</label>
              <input value={apiKey} onChange={e => setApiKey(e.target.value)} type="password" placeholder="••••••••••••" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setStep('select')} className="flex-1 px-4 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50">
                Atrás
              </button>
              <button onClick={handleConnect} disabled={loading || !apiKey} className="flex-1 px-4 py-2 bg-sky-600 hover:bg-sky-700 disabled:bg-sky-400 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2">
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                Conectar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
