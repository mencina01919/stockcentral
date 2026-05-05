'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Webhook, Loader2, Trash2, RefreshCw, Play, Eye,
  CheckCircle2, XCircle, Clock, Copy, ChevronDown, ChevronUp,
} from 'lucide-react'
import api from '@/lib/api'
import { Header } from '@/components/layout/header'
import { toast } from 'sonner'
import { formatDate } from '@/lib/utils'

const EVENT_GROUPS = [
  { group: 'Órdenes', events: ['order.created', 'order.updated', 'order.cancelled', 'order.fulfilled'] },
  { group: 'Productos', events: ['product.created', 'product.updated', 'product.deleted'] },
  { group: 'Inventario', events: ['inventory.low_stock', 'inventory.out_of_stock'] },
  { group: 'Sincronización', events: ['sync.completed', 'sync.failed'] },
]

export default function WebhooksPage() {
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [selectedWebhook, setSelectedWebhook] = useState<any>(null)
  const [showDeliveries, setShowDeliveries] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['webhooks'],
    queryFn: () => api.get('/webhooks').then((r) => r.data),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/webhooks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] })
      toast.success('Webhook eliminado')
    },
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.patch(`/webhooks/${id}`, { active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] })
      toast.success('Webhook actualizado')
    },
  })

  const regenerateMutation = useMutation({
    mutationFn: (id: string) => api.post(`/webhooks/${id}/regenerate-secret`),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] })
      toast.success('Secret regenerado')
    },
    onError: () => toast.error('Error al regenerar secret'),
  })

  const webhooks = data?.data || []

  const openDeliveries = (webhook: any) => {
    setSelectedWebhook(webhook)
    setShowDeliveries(true)
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="Webhooks" subtitle="Recibe notificaciones en tiempo real cuando ocurran eventos" />

      <div className="flex-1 p-6 overflow-auto space-y-6">
        <div className="bg-sky-50 border border-sky-200 rounded-xl p-4 text-sm text-sky-800">
          <p className="font-semibold mb-1">¿Cómo funcionan los webhooks?</p>
          <p className="text-sky-700">
            StockCentral enviará una solicitud POST a tu URL con un payload JSON cada vez que ocurra un evento.
            Verifica la firma <code className="bg-sky-100 px-1 rounded font-mono">X-StockCentral-Signature</code> usando tu secret para validar la autenticidad.
          </p>
        </div>

        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">{webhooks.length} webhook{webhooks.length !== 1 ? 's' : ''} configurado{webhooks.length !== 1 ? 's' : ''}</h2>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nuevo webhook
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
          </div>
        ) : webhooks.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm text-center py-16">
            <Webhook className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No hay webhooks configurados</p>
            <p className="text-gray-400 text-sm mt-1">Crea tu primer webhook para recibir notificaciones</p>
          </div>
        ) : (
          <div className="space-y-3">
            {webhooks.map((webhook: any) => (
              <WebhookCard
                key={webhook.id}
                webhook={webhook}
                onDelete={() => deleteMutation.mutate(webhook.id)}
                onToggle={(active: boolean) => toggleMutation.mutate({ id: webhook.id, active })}
                onRegenerateSecret={() => regenerateMutation.mutate(webhook.id)}
                onViewDeliveries={() => openDeliveries(webhook)}
                queryClient={queryClient}
              />
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateWebhookModal
          onClose={() => setShowCreate(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['webhooks'] })
            setShowCreate(false)
          }}
        />
      )}

      {showDeliveries && selectedWebhook && (
        <DeliveriesModal
          webhook={selectedWebhook}
          onClose={() => { setShowDeliveries(false); setSelectedWebhook(null) }}
        />
      )}
    </div>
  )
}

function WebhookCard({ webhook, onDelete, onToggle, onRegenerateSecret, onViewDeliveries, queryClient }: any) {
  const [showSecret, setShowSecret] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [testEvent, setTestEvent] = useState(webhook.events[0] || 'order.created')

  const testMutation = useMutation({
    mutationFn: () => api.post(`/webhooks/${webhook.id}/test`, { event: testEvent }),
    onSuccess: (data) => {
      const status = data.data?.status
      if (status === 'success') toast.success('Test enviado correctamente')
      else toast.error(`Test falló: HTTP ${data.data?.responseStatus || 'sin respuesta'}`)
    },
    onError: () => toast.error('Error al enviar test'),
  })

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('Copiado al portapapeles')
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className={`w-2 h-2 rounded-full ${webhook.active ? 'bg-green-500' : 'bg-gray-400'}`} />
              <p className="text-sm font-medium text-gray-900 truncate">{webhook.url}</p>
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              {webhook.events.map((event: string) => (
                <span key={event} className="px-2 py-0.5 bg-sky-50 text-sky-700 text-xs rounded-full font-medium border border-sky-100">
                  {event}
                </span>
              ))}
            </div>
            {webhook.lastTriggered && (
              <p className="text-xs text-gray-400 mt-2">
                Último disparo: {formatDate(webhook.lastTriggered)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => onToggle(!webhook.active)}
              className={`px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                webhook.active
                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {webhook.active ? 'Activo' : 'Inactivo'}
            </button>
            <button
              onClick={onViewDeliveries}
              className="p-1.5 text-gray-400 hover:text-sky-600 hover:bg-sky-50 rounded transition-colors"
              title="Ver entregas"
            >
              <Eye className="w-4 h-4" />
            </button>
            <button
              onClick={onDelete}
              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
              title="Eliminar"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded transition-colors"
            >
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 p-5 space-y-4 bg-gray-50/50">
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Secret de firma</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-gray-100 px-3 py-2 rounded-lg font-mono text-gray-700 truncate">
                {showSecret ? webhook.secret : '••••••••••••••••••••••••••••••••'}
              </code>
              <button
                onClick={() => setShowSecret(!showSecret)}
                className="text-xs text-sky-600 hover:text-sky-700 px-2 py-2 rounded-lg hover:bg-sky-50 transition-colors whitespace-nowrap"
              >
                {showSecret ? 'Ocultar' : 'Mostrar'}
              </button>
              <button
                onClick={() => copyToClipboard(webhook.secret)}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onRegenerateSecret}
                className="p-2 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                title="Regenerar secret"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">Enviar test</p>
            <div className="flex items-center gap-2">
              <select
                value={testEvent}
                onChange={(e) => setTestEvent(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-sky-500 bg-white"
              >
                {webhook.events.map((ev: string) => (
                  <option key={ev} value={ev}>{ev}</option>
                ))}
              </select>
              <button
                onClick={() => testMutation.mutate()}
                disabled={testMutation.isPending}
                className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-700 text-white px-3 py-2 rounded-lg text-xs font-medium transition-colors"
              >
                {testMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                Enviar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CreateWebhookModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [url, setUrl] = useState('')
  const [selectedEvents, setSelectedEvents] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  const toggleEvent = (event: string) => {
    setSelectedEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
    )
  }

  const toggleGroup = (events: string[]) => {
    const allSelected = events.every((e) => selectedEvents.includes(e))
    if (allSelected) {
      setSelectedEvents((prev) => prev.filter((e) => !events.includes(e)))
    } else {
      setSelectedEvents((prev) => [...new Set([...prev, ...events])])
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (selectedEvents.length === 0) {
      toast.error('Selecciona al menos un evento')
      return
    }
    setLoading(true)
    try {
      await api.post('/webhooks', { url, events: selectedEvents })
      toast.success('Webhook creado correctamente')
      onSuccess()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Error al crear webhook')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Nuevo webhook</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">URL de destino *</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              placeholder="https://tu-app.com/webhooks/stockcentral"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Eventos a escuchar *</label>
            <div className="space-y-3">
              {EVENT_GROUPS.map(({ group, events }) => {
                const allSelected = events.every((e) => selectedEvents.includes(e))
                const someSelected = events.some((e) => selectedEvents.includes(e))
                return (
                  <div key={group} className="border border-gray-200 rounded-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleGroup(events)}
                      className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors"
                    >
                      <span className="text-sm font-medium text-gray-700">{group}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${allSelected ? 'bg-sky-100 text-sky-700' : someSelected ? 'bg-gray-100 text-gray-500' : 'text-gray-400'}`}>
                        {allSelected ? 'Todos' : someSelected ? 'Algunos' : 'Ninguno'}
                      </span>
                    </button>
                    <div className="px-4 py-2 grid grid-cols-2 gap-1">
                      {events.map((event) => (
                        <label key={event} className="flex items-center gap-2 py-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedEvents.includes(event)}
                            onChange={() => toggleEvent(event)}
                            className="w-3.5 h-3.5 text-sky-600 rounded"
                          />
                          <span className="text-xs text-gray-600 font-mono">{event}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {selectedEvents.length > 0 && (
            <p className="text-xs text-gray-500">{selectedEvents.length} evento{selectedEvents.length !== 1 ? 's' : ''} seleccionado{selectedEvents.length !== 1 ? 's' : ''}</p>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition-colors">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Crear webhook
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function DeliveriesModal({ webhook, onClose }: { webhook: any; onClose: () => void }) {
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['webhook-deliveries', webhook.id, page],
    queryFn: () => api.get(`/webhooks/${webhook.id}/deliveries`, { params: { page, limit: 15 } }).then((r) => r.data),
  })

  const deliveries = data?.data || []
  const meta = data?.meta

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-2xl shadow-2xl max-h-[85vh] flex flex-col">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Historial de entregas</h2>
            <p className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">{webhook.url}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
            </div>
          ) : deliveries.length === 0 ? (
            <div className="text-center py-16">
              <Clock className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">No hay entregas registradas aún</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {deliveries.map((delivery: any) => (
                <DeliveryRow key={delivery.id} delivery={delivery} />
              ))}
            </div>
          )}
        </div>

        {meta && meta.totalPages > 1 && (
          <div className="p-4 border-t border-gray-100 flex items-center justify-between">
            <p className="text-xs text-gray-500">{meta.total} entregas</p>
            <div className="flex gap-2">
              <button onClick={() => setPage((p) => p - 1)} disabled={!meta.hasPrevPage} className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Anterior</button>
              <button onClick={() => setPage((p) => p + 1)} disabled={!meta.hasNextPage} className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Siguiente</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function DeliveryRow({ delivery }: { delivery: any }) {
  const [expanded, setExpanded] = useState(false)
  const success = delivery.status === 'success'

  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          {success ? (
            <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
          ) : (
            <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
          )}
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-semibold text-gray-700">{delivery.event}</span>
              {delivery.responseStatus && (
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                  delivery.responseStatus >= 200 && delivery.responseStatus < 300
                    ? 'bg-green-100 text-green-700'
                    : 'bg-red-100 text-red-600'
                }`}>
                  HTTP {delivery.responseStatus}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-0.5">{formatDate(delivery.createdAt)}</p>
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-sky-600 hover:text-sky-700"
        >
          {expanded ? 'Ocultar' : 'Ver payload'}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 space-y-2">
          <div>
            <p className="text-xs font-medium text-gray-500 mb-1">Payload enviado</p>
            <pre className="text-xs bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-x-auto text-gray-700 max-h-48">
              {JSON.stringify(delivery.payload, null, 2)}
            </pre>
          </div>
          {delivery.responseBody && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Respuesta</p>
              <pre className="text-xs bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-x-auto text-gray-700 max-h-32">
                {delivery.responseBody}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
