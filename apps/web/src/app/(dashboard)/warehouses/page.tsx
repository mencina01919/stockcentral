'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Warehouse, ArrowRightLeft, Loader2, X, ChevronDown, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'
import api from '@/lib/api'
import { cn } from '@/lib/utils'

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  online:    { label: 'Online',   color: 'bg-sky-100 text-sky-700' },
  warehouse: { label: 'Bodega',   color: 'bg-amber-100 text-amber-700' },
  store:     { label: 'Tienda',   color: 'bg-purple-100 text-purple-700' },
  custom:    { label: 'Personalizada', color: 'bg-gray-100 text-gray-600' },
}

export default function WarehousesPage() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [showTransfer, setShowTransfer] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: warehouses = [], isLoading } = useQuery<any[]>({
    queryKey: ['warehouses'],
    queryFn: () => api.get('/warehouses').then(r => r.data),
  })

  const { data: transfers = [] } = useQuery<any[]>({
    queryKey: ['transfers'],
    queryFn: () => api.get('/warehouses/transfers').then(r => r.data),
  })

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/warehouses', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['warehouses'] }); setShowCreate(false); toast.success('Bodega creada') },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error al crear bodega'),
  })

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/warehouses/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['warehouses'] }); toast.success('Bodega desactivada') },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error al desactivar'),
  })

  const transferMutation = useMutation({
    mutationFn: (data: any) => api.post('/warehouses/transfer', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['warehouses'] }); setShowTransfer(false); toast.success('Transferencia realizada') },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error en transferencia'),
  })

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bodegas</h1>
          <p className="text-sm text-gray-500 mt-1">Gestiona tus ubicaciones de stock</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowTransfer(true)}
            className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">
            <ArrowRightLeft className="w-4 h-4" /> Transferir stock
          </button>
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-sky-600 text-white rounded-xl text-sm font-medium hover:bg-sky-700">
            <Plus className="w-4 h-4" /> Nueva bodega
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {warehouses.map((wh: any) => {
            const typeInfo = TYPE_LABELS[wh.warehouseType] || TYPE_LABELS.custom
            const expanded = expandedId === wh.id
            return (
              <div key={wh.id} className={cn('bg-white border rounded-xl overflow-hidden', !wh.active && 'opacity-60')}>
                <div className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
                        <Warehouse className="w-5 h-5 text-gray-500" />
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900">{wh.name}</p>
                        <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', typeInfo.color)}>
                          {typeInfo.label}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {wh.isDefault && (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Principal</span>
                      )}
                      {!wh.active && (
                        <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">Inactiva</span>
                      )}
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
                    <span>{wh._count?.inventory ?? 0} productos</span>
                    <div className="flex gap-2">
                      <button onClick={() => setExpandedId(expanded ? null : wh.id)}
                        className="p-1 hover:bg-gray-100 rounded-lg">
                        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                      {wh.warehouseType === 'custom' && wh.active && (
                        <button onClick={() => deactivateMutation.mutate(wh.id)}
                          className="p-1 hover:bg-red-50 rounded-lg text-red-500">
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                {expanded && wh.inventory && (
                  <div className="border-t px-5 py-3 bg-gray-50 space-y-2 max-h-48 overflow-y-auto">
                    {wh.inventory.length === 0 ? (
                      <p className="text-xs text-gray-400">Sin stock registrado</p>
                    ) : wh.inventory.map((inv: any) => (
                      <div key={inv.id} className="flex items-center justify-between text-xs">
                        <span className="text-gray-700 truncate max-w-[60%]">{inv.product?.name}</span>
                        <span className="font-semibold text-gray-900">{inv.quantity} u.</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Historial de transferencias */}
      {transfers.length > 0 && (
        <div className="bg-white border rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b">
            <h2 className="font-semibold text-gray-900">Historial de transferencias</h2>
          </div>
          <div className="divide-y">
            {transfers.slice(0, 20).map((t: any) => (
              <div key={t.id} className="px-6 py-3 flex items-center gap-4 text-sm">
                <ArrowRightLeft className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <span className="text-gray-600 truncate flex-1">
                  {t.product?.name} <span className="text-gray-400 text-xs">({t.product?.sku})</span>
                </span>
                <span className="text-gray-500">{t.fromWarehouse?.name}</span>
                <ArrowRightLeft className="w-3 h-3 text-gray-300" />
                <span className="text-gray-500">{t.toWarehouse?.name}</span>
                <span className="font-semibold text-gray-900 w-16 text-right">{t.quantity} u.</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal crear bodega */}
      {showCreate && <CreateWarehouseModal onClose={() => setShowCreate(false)} onSubmit={createMutation.mutate} loading={createMutation.isPending} />}

      {/* Modal transferencia */}
      {showTransfer && (
        <TransferModal
          warehouses={warehouses}
          onClose={() => setShowTransfer(false)}
          onSubmit={transferMutation.mutate}
          loading={transferMutation.isPending}
        />
      )}
    </div>
  )
}

function CreateWarehouseModal({ onClose, onSubmit, loading }: any) {
  const [name, setName] = useState('')
  const [type, setType] = useState('custom')

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Nueva Bodega</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium text-gray-700">Nombre</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              placeholder="Ej: Bodega Norte" />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Tipo</label>
            <select value={type} onChange={e => setType(e.target.value)}
              className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
              <option value="custom">Personalizada</option>
              <option value="online">Online</option>
              <option value="warehouse">Bodega</option>
              <option value="store">Tienda</option>
            </select>
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-200 rounded-xl text-sm font-medium">Cancelar</button>
          <button onClick={() => onSubmit({ name, warehouseType: type })} disabled={!name || loading}
            className="flex-1 px-4 py-2 bg-sky-600 text-white rounded-xl text-sm font-medium hover:bg-sky-700 disabled:opacity-50 flex items-center justify-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} Crear
          </button>
        </div>
      </div>
    </div>
  )
}

function TransferModal({ warehouses, onClose, onSubmit, loading }: any) {
  const [form, setForm] = useState({ fromWarehouseId: '', toWarehouseId: '', productId: '', quantity: 1, reason: '' })
  const { data: products = [] } = useQuery<any[]>({ queryKey: ['products-all'], queryFn: () => api.get('/products?limit=200').then(r => r.data.data) })
  const activeWh = warehouses.filter((w: any) => w.active)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Transferir Stock</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="space-y-3">
          {[
            { label: 'Producto', key: 'productId', options: products.map((p: any) => ({ value: p.id, label: `${p.sku} — ${p.name}` })) },
            { label: 'Desde bodega', key: 'fromWarehouseId', options: activeWh.map((w: any) => ({ value: w.id, label: w.name })) },
            { label: 'Hacia bodega', key: 'toWarehouseId', options: activeWh.map((w: any) => ({ value: w.id, label: w.name })) },
          ].map(({ label, key, options }) => (
            <div key={key}>
              <label className="text-sm font-medium text-gray-700">{label}</label>
              <select value={(form as any)[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
                <option value="">Seleccionar...</option>
                {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          ))}
          <div>
            <label className="text-sm font-medium text-gray-700">Cantidad</label>
            <input type="number" min={1} value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: Number(e.target.value) }))}
              className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700">Motivo (opcional)</label>
            <input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
              className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              placeholder="Ej: Reabastecimiento tienda" />
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-200 rounded-xl text-sm font-medium">Cancelar</button>
          <button onClick={() => onSubmit(form)}
            disabled={!form.productId || !form.fromWarehouseId || !form.toWarehouseId || form.quantity < 1 || loading}
            className="flex-1 px-4 py-2 bg-sky-600 text-white rounded-xl text-sm font-medium hover:bg-sky-700 disabled:opacity-50 flex items-center justify-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} Transferir
          </button>
        </div>
      </div>
    </div>
  )
}
