'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Warehouse, ArrowRightLeft, Loader2, X, ChevronDown, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'
import api from '@/lib/api'
import { Header } from '@/components/layout/header'
import { Panel, MonoLabel, Chip } from '@/components/sc/ui'
import { cn } from '@/lib/utils'

const TYPE_LABELS: Record<string, { label: string; tone: 'blue' | 'warn' | 'cyan' | 'low' }> = {
  online: { label: 'ONLINE', tone: 'blue' },
  warehouse: { label: 'BODEGA', tone: 'warn' },
  store: { label: 'TIENDA', tone: 'cyan' },
  custom: { label: 'PERSONALIZADA', tone: 'low' },
}

export default function WarehousesPage() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [showTransfer, setShowTransfer] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: warehouses = [], isLoading } = useQuery<any[]>({
    queryKey: ['warehouses'],
    queryFn: () => api.get('/warehouses').then((r) => r.data),
  })

  const { data: transfers = [] } = useQuery<any[]>({
    queryKey: ['transfers'],
    queryFn: () => api.get('/warehouses/transfers').then((r) => r.data),
  })

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/warehouses', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['warehouses'] })
      setShowCreate(false)
      toast.success('Bodega creada')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error al crear bodega'),
  })

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/warehouses/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['warehouses'] })
      toast.success('Bodega desactivada')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error al desactivar'),
  })

  const transferMutation = useMutation({
    mutationFn: (data: any) => api.post('/warehouses/transfer', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['warehouses'] })
      setShowTransfer(false)
      toast.success('Transferencia realizada')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error en transferencia'),
  })

  return (
    <div className="flex flex-col h-full">
      <Header
        breadcrumbs={['CONSOLA', 'BODEGAS']}
        title="Bodegas & sucursales"
        subtitle={`${warehouses.length} ubicación${warehouses.length !== 1 ? 'es' : ''} registrada${warehouses.length !== 1 ? 's' : ''}`}
        actions={
          <>
            <button
              onClick={() => setShowTransfer(true)}
              className="sc-btn-ghost"
              style={{ padding: '8px 14px', fontSize: 12 }}
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              Transferir stock
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="sc-btn-primary"
              style={{ padding: '8px 14px', fontSize: 12 }}
            >
              <Plus className="w-3.5 h-3.5" />
              Nueva bodega
            </button>
          </>
        }
      />

      <div className="flex-1 px-7 py-6 overflow-auto space-y-5">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--sc-blue-500)' }} />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {warehouses.map((wh: any) => {
              const typeInfo = TYPE_LABELS[wh.warehouseType] || TYPE_LABELS.custom
              const expanded = expandedId === wh.id
              return (
                <Panel
                  key={wh.id}
                  className={cn('overflow-hidden', !wh.active && 'opacity-60')}
                >
                  <div style={{ padding: 20 }}>
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div
                          className="flex items-center justify-center"
                          style={{
                            width: 44,
                            height: 44,
                            borderRadius: 10,
                            background: 'linear-gradient(135deg, #dbeafe, #bfdbfe)',
                            border: '1px solid var(--sc-line-soft)',
                          }}
                        >
                          <Warehouse className="w-5 h-5" style={{ color: 'var(--sc-blue-700)' }} />
                        </div>
                        <div>
                          <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--sc-text-hi)' }}>
                            {wh.name}
                          </p>
                          <div className="mt-1 flex items-center gap-2">
                            <Chip tone={typeInfo.tone}>{typeInfo.label}</Chip>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {wh.isDefault && <Chip tone="ok">PRINCIPAL</Chip>}
                        {!wh.active && <Chip tone="err">INACTIVA</Chip>}
                      </div>
                    </div>
                    <div
                      className="flex items-center justify-between"
                      style={{
                        fontSize: 13,
                        color: 'var(--sc-text-mid)',
                        paddingTop: 14,
                        borderTop: '1px solid var(--sc-line-faint)',
                      }}
                    >
                      <span className="sc-mono" style={{ fontSize: 12 }}>
                        {wh._count?.inventory ?? 0} productos
                      </span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setExpandedId(expanded ? null : wh.id)}
                          className="sc-btn-ghost"
                          style={{ padding: 6 }}
                          aria-label="Expandir"
                        >
                          {expanded ? (
                            <ChevronUp className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                          )}
                        </button>
                        {wh.warehouseType === 'custom' && wh.active && (
                          <button
                            onClick={() => deactivateMutation.mutate(wh.id)}
                            className="sc-btn-ghost"
                            style={{
                              padding: 6,
                              color: 'var(--sc-err)',
                              borderColor: 'rgba(220,38,38,0.20)',
                            }}
                            aria-label="Eliminar"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                  {expanded && wh.inventory && (
                    <div
                      className="space-y-2"
                      style={{
                        padding: 16,
                        borderTop: '1px solid var(--sc-line-soft)',
                        background: '#f7f9fd',
                        maxHeight: 200,
                        overflowY: 'auto',
                      }}
                    >
                      {wh.inventory.length === 0 ? (
                        <p style={{ fontSize: 12, color: 'var(--sc-text-faint)' }}>Sin stock registrado</p>
                      ) : (
                        wh.inventory.map((inv: any) => (
                          <div key={inv.id} className="flex items-center justify-between" style={{ fontSize: 12 }}>
                            <span style={{ color: 'var(--sc-text-mid)' }} className="truncate" >
                              {inv.product?.name}
                            </span>
                            <span
                              className="sc-mono"
                              style={{ fontWeight: 600, color: 'var(--sc-text-hi)' }}
                            >
                              {inv.quantity} u.
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </Panel>
              )
            })}
          </div>
        )}

        {transfers.length > 0 && (
          <Panel className="overflow-hidden">
            <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--sc-line-soft)' }}>
              <MonoLabel tone="blue">// TRANSFERS.LOG</MonoLabel>
              <h3
                className="mt-1"
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: 'var(--sc-text-hi)',
                  letterSpacing: '-0.01em',
                }}
              >
                Historial de transferencias
              </h3>
            </div>
            <div>
              {transfers.slice(0, 20).map((t: any) => (
                <div
                  key={t.id}
                  className="flex items-center gap-4"
                  style={{
                    padding: '12px 24px',
                    borderBottom: '1px solid var(--sc-line-faint)',
                    fontSize: 13,
                  }}
                >
                  <ArrowRightLeft
                    className="w-3.5 h-3.5 flex-shrink-0"
                    style={{ color: 'var(--sc-text-low)' }}
                  />
                  <span style={{ color: 'var(--sc-text-mid)', flex: 1 }} className="truncate">
                    {t.product?.name}{' '}
                    <span className="sc-mono" style={{ color: 'var(--sc-text-faint)', fontSize: 11 }}>
                      ({t.product?.sku})
                    </span>
                  </span>
                  <span style={{ color: 'var(--sc-text-mid)' }}>{t.fromWarehouse?.name}</span>
                  <ArrowRightLeft className="w-3 h-3" style={{ color: 'var(--sc-text-faint)' }} />
                  <span style={{ color: 'var(--sc-text-mid)' }}>{t.toWarehouse?.name}</span>
                  <span
                    className="sc-mono text-right"
                    style={{ fontWeight: 600, color: 'var(--sc-text-hi)', width: 64 }}
                  >
                    {t.quantity} u.
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </div>

      {showCreate && (
        <CreateWarehouseModal
          onClose={() => setShowCreate(false)}
          onSubmit={createMutation.mutate}
          loading={createMutation.isPending}
        />
      )}

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

function ModalShell({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(11,31,63,0.5)', backdropFilter: 'blur(4px)' }}
    >
      <Panel className="w-full max-w-md" style={{ padding: 24 }}>
        <div className="flex items-center justify-between mb-4">
          <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--sc-text-hi)' }}>{title}</h2>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--sc-text-low)' }}
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </Panel>
    </div>
  )
}

function CreateWarehouseModal({ onClose, onSubmit, loading }: any) {
  const [name, setName] = useState('')
  const [type, setType] = useState('custom')

  return (
    <ModalShell title="Nueva bodega" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <MonoLabel>NOMBRE</MonoLabel>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="sc-input mt-1.5"
            placeholder="Ej: Bodega Norte"
          />
        </div>
        <div>
          <MonoLabel>TIPO</MonoLabel>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="sc-input mt-1.5"
          >
            <option value="custom">Personalizada</option>
            <option value="online">Online</option>
            <option value="warehouse">Bodega</option>
            <option value="store">Tienda</option>
          </select>
        </div>
      </div>
      <div className="flex gap-3 mt-5">
        <button onClick={onClose} className="sc-btn-ghost" style={{ flex: 1, justifyContent: 'center' }}>
          Cancelar
        </button>
        <button
          onClick={() => onSubmit({ name, warehouseType: type })}
          disabled={!name || loading}
          className="sc-btn-primary"
          style={{ flex: 1, justifyContent: 'center' }}
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          Crear
        </button>
      </div>
    </ModalShell>
  )
}

function TransferModal({ warehouses, onClose, onSubmit, loading }: any) {
  const [form, setForm] = useState({
    fromWarehouseId: '',
    toWarehouseId: '',
    productId: '',
    quantity: 1,
    reason: '',
  })
  const { data: products = [] } = useQuery<any[]>({
    queryKey: ['products-all'],
    queryFn: () => api.get('/products?limit=200').then((r) => r.data.data),
  })
  const activeWh = warehouses.filter((w: any) => w.active)

  return (
    <ModalShell title="Transferir stock" onClose={onClose}>
      <div className="space-y-3">
        {[
          { label: 'PRODUCTO', key: 'productId', options: products.map((p: any) => ({ value: p.id, label: `${p.sku} — ${p.name}` })) },
          { label: 'DESDE BODEGA', key: 'fromWarehouseId', options: activeWh.map((w: any) => ({ value: w.id, label: w.name })) },
          { label: 'HACIA BODEGA', key: 'toWarehouseId', options: activeWh.map((w: any) => ({ value: w.id, label: w.name })) },
        ].map(({ label, key, options }) => (
          <div key={key}>
            <MonoLabel>{label}</MonoLabel>
            <select
              value={(form as any)[key]}
              onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              className="sc-input mt-1.5"
            >
              <option value="">Seleccionar…</option>
              {options.map((o: any) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        ))}
        <div>
          <MonoLabel>CANTIDAD</MonoLabel>
          <input
            type="number"
            min={1}
            value={form.quantity}
            onChange={(e) => setForm((f) => ({ ...f, quantity: Number(e.target.value) }))}
            className="sc-input mt-1.5"
          />
        </div>
        <div>
          <MonoLabel>MOTIVO (OPCIONAL)</MonoLabel>
          <input
            value={form.reason}
            onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
            className="sc-input mt-1.5"
            placeholder="Ej: Reabastecimiento tienda"
          />
        </div>
      </div>
      <div className="flex gap-3 mt-5">
        <button onClick={onClose} className="sc-btn-ghost" style={{ flex: 1, justifyContent: 'center' }}>
          Cancelar
        </button>
        <button
          onClick={() => onSubmit(form)}
          disabled={
            !form.productId ||
            !form.fromWarehouseId ||
            !form.toWarehouseId ||
            form.quantity < 1 ||
            loading
          }
          className="sc-btn-primary"
          style={{ flex: 1, justifyContent: 'center' }}
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          Transferir
        </button>
      </div>
    </ModalShell>
  )
}
