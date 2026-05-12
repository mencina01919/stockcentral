'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Percent, Plus, Loader2, X, Calendar, Tag, AlertTriangle, RefreshCw,
  PlayCircle, StopCircle, Trash2, ChevronRight, ExternalLink,
} from 'lucide-react'
import api from '@/lib/api'
import { Header } from '@/components/layout/header'
import { Panel, Chip, StatusBadge } from '@/components/sc/ui'
import { formatCurrency, formatDate, PROVIDER_LABELS } from '@/lib/utils'
import { toast } from 'sonner'

type StatusFilter = 'all' | 'scheduled' | 'active' | 'expired' | 'cancelled'

const STATUS_LABEL: Record<string, { label: string; tone: 'ok' | 'warn' | 'err' | 'low' | 'blue' }> = {
  scheduled: { label: 'Programada', tone: 'blue' },
  active: { label: 'Vigente', tone: 'ok' },
  expired: { label: 'Expirada', tone: 'low' },
  cancelled: { label: 'Cancelada', tone: 'err' },
}

const SYNC_LABEL: Record<string, { label: string; tone: 'ok' | 'warn' | 'err' | 'low' }> = {
  success: { label: 'Sincronizada', tone: 'ok' },
  pending: { label: 'Pendiente', tone: 'warn' },
  failed: { label: 'Falló', tone: 'err' },
}

export default function OffersPage() {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [createOpen, setCreateOpen] = useState(false)

  const { data: offers, isLoading } = useQuery({
    queryKey: ['offers', filter],
    queryFn: () =>
      api
        .get('/offers', { params: filter !== 'all' ? { status: filter } : {} })
        .then((r) => r.data),
  })

  const activateMut = useMutation({
    mutationFn: (id: string) => api.post(`/offers/${id}/activate-now`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['offers'] })
      toast.success('Oferta activada y pusheada al marketplace')
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Error al activar'),
  })

  const expireMut = useMutation({
    mutationFn: (id: string) => api.post(`/offers/${id}/expire-now`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['offers'] })
      toast.success('Oferta expirada y limpiada en el marketplace')
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Error al expirar'),
  })

  const resyncMut = useMutation({
    mutationFn: (id: string) => api.post(`/offers/${id}/resync`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['offers'] })
      toast.success('Re-sincronización encolada')
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Error al re-sincronizar'),
  })

  const cancelMut = useMutation({
    mutationFn: (id: string) => api.delete(`/offers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['offers'] })
      toast.success('Oferta cancelada')
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Error al cancelar'),
  })

  const rows: any[] = offers || []

  const tabs: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'Todas' },
    { key: 'scheduled', label: 'Programadas' },
    { key: 'active', label: 'Vigentes' },
    { key: 'expired', label: 'Expiradas' },
    { key: 'cancelled', label: 'Canceladas' },
  ]

  return (
    <div className="flex flex-col h-full">
      <Header
        breadcrumbs={['CONSOLA', 'OFERTAS']}
        title="Ofertas por marketplace"
        subtitle={`${rows.length} oferta${rows.length === 1 ? '' : 's'} · descuento por porcentaje sobre precio calculado`}
        actions={
          <button
            onClick={() => setCreateOpen(true)}
            className="sc-btn-primary"
            style={{ padding: '8px 14px', fontSize: 12 }}
          >
            <Plus className="w-3.5 h-3.5" /> Nueva oferta
          </button>
        }
      />

      <div className="flex-1 px-7 py-6 overflow-auto">
        <Panel className="overflow-hidden">
          {/* Tabs */}
          <div
            className="flex gap-1 overflow-x-auto"
            style={{ padding: '0 16px', borderBottom: '1px solid var(--sc-line-soft)' }}
          >
            {tabs.map((tab) => {
              const active = filter === tab.key
              return (
                <button
                  key={tab.key}
                  onClick={() => setFilter(tab.key)}
                  style={{
                    padding: '13px 16px',
                    fontSize: 13,
                    fontWeight: 500,
                    color: active ? 'var(--sc-blue-600)' : 'var(--sc-text-mid)',
                    background: 'transparent',
                    border: 'none',
                    borderBottomWidth: 2,
                    borderBottomStyle: 'solid',
                    borderBottomColor: active ? 'var(--sc-blue-600)' : 'transparent',
                    whiteSpace: 'nowrap',
                    cursor: 'pointer',
                    transition: 'color .15s',
                  }}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--sc-blue-500)' }} />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState onCreate={() => setCreateOpen(true)} filter={filter} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    {['MARKETPLACE', 'PRODUCTO', 'DESCUENTO', 'PRECIO OFERTA', 'VIGENCIA', 'ESTADO', 'SYNC', ''].map((h, i) => (
                      <th
                        key={i}
                        className="sc-mono text-left"
                        style={{
                          padding: '12px 16px',
                          fontSize: 10.5,
                          letterSpacing: '0.16em',
                          color: 'var(--sc-text-low)',
                          background: '#f7f9fd',
                          borderBottom: '1px solid var(--sc-line-soft)',
                          fontWeight: 500,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o: any) => {
                    const statusInfo = STATUS_LABEL[o.status] || { label: o.status, tone: 'low' as const }
                    const syncInfo = SYNC_LABEL[o.syncStatus] || { label: o.syncStatus, tone: 'low' as const }
                    const providerLabel = PROVIDER_LABELS[o.connection?.provider] || o.connection?.provider
                    return (
                      <tr key={o.id} className="sc-row">
                        <td style={{ padding: '13px 16px', borderBottom: '1px solid var(--sc-line-faint)' }}>
                          <div style={{ fontWeight: 500, color: 'var(--sc-text-hi)' }}>{providerLabel}</div>
                          {o.source === 'detected_external' && (
                            <Chip tone="warn">Detectada externamente</Chip>
                          )}
                        </td>
                        <td
                          style={{
                            padding: '13px 16px',
                            borderBottom: '1px solid var(--sc-line-faint)',
                            maxWidth: 340,
                          }}
                        >
                          <div style={{ color: 'var(--sc-text-mid)', fontSize: 13 }}>
                            {o.product?.name || '—'}
                          </div>
                          <div className="sc-mono" style={{ fontSize: 10, color: 'var(--sc-text-low)' }}>
                            SKU {o.product?.sku || '—'}
                          </div>
                        </td>
                        <td
                          className="sc-mono"
                          style={{
                            padding: '13px 16px',
                            fontWeight: 600,
                            color: '#b91c1c',
                            borderBottom: '1px solid var(--sc-line-faint)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          -{Number(o.discountPct).toFixed(0)}%
                        </td>
                        <td
                          className="sc-mono"
                          style={{
                            padding: '13px 16px',
                            fontWeight: 600,
                            color: 'var(--sc-text-hi)',
                            borderBottom: '1px solid var(--sc-line-faint)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {o.calculatedSalePrice ? (
                            <>
                              {formatCurrency(Number(o.calculatedSalePrice), 'CLP')}
                              {o.basePriceAtActivation && (
                                <div
                                  style={{
                                    fontSize: 10,
                                    color: 'var(--sc-text-faint)',
                                    textDecoration: 'line-through',
                                    fontWeight: 400,
                                  }}
                                >
                                  {formatCurrency(Number(o.basePriceAtActivation), 'CLP')}
                                </div>
                              )}
                            </>
                          ) : (
                            <span style={{ color: 'var(--sc-text-faint)' }}>—</span>
                          )}
                        </td>
                        <td
                          className="sc-mono"
                          style={{
                            padding: '13px 16px',
                            fontSize: 11,
                            color: 'var(--sc-text-low)',
                            borderBottom: '1px solid var(--sc-line-faint)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <div>{formatDate(o.startDate)}</div>
                          <div style={{ color: 'var(--sc-text-faint)' }}>→ {formatDate(o.endDate)}</div>
                        </td>
                        <td style={{ padding: '13px 16px', borderBottom: '1px solid var(--sc-line-faint)' }}>
                          <StatusBadge tone={statusInfo.tone}>{statusInfo.label}</StatusBadge>
                        </td>
                        <td style={{ padding: '13px 16px', borderBottom: '1px solid var(--sc-line-faint)' }}>
                          <StatusBadge tone={syncInfo.tone}>{syncInfo.label}</StatusBadge>
                          {o.syncError && (
                            <div
                              style={{ fontSize: 10, color: '#dc2626', marginTop: 3, maxWidth: 200 }}
                              className="line-clamp-2"
                              title={o.syncError}
                            >
                              {o.syncError}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '13px 16px', borderBottom: '1px solid var(--sc-line-faint)' }}>
                          <div className="flex items-center gap-1">
                            {o.status === 'scheduled' && (
                              <button
                                onClick={() => activateMut.mutate(o.id)}
                                disabled={activateMut.isPending}
                                title="Activar y pushear ahora"
                                className="sc-btn-ghost"
                                style={{ padding: 6 }}
                              >
                                <PlayCircle className="w-3.5 h-3.5" style={{ color: '#16a34a' }} />
                              </button>
                            )}
                            {o.status === 'active' && (
                              <>
                                <button
                                  onClick={() => resyncMut.mutate(o.id)}
                                  disabled={resyncMut.isPending}
                                  title="Re-sincronizar (drift fix)"
                                  className="sc-btn-ghost"
                                  style={{ padding: 6 }}
                                >
                                  <RefreshCw className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => expireMut.mutate(o.id)}
                                  disabled={expireMut.isPending}
                                  title="Expirar ahora y limpiar marketplace"
                                  className="sc-btn-ghost"
                                  style={{ padding: 6 }}
                                >
                                  <StopCircle className="w-3.5 h-3.5" style={{ color: '#dc2626' }} />
                                </button>
                              </>
                            )}
                            {(o.status === 'scheduled' || o.status === 'active') && (
                              <button
                                onClick={() => {
                                  if (confirm('¿Cancelar esta oferta? Si está activa se limpia en el marketplace.')) {
                                    cancelMut.mutate(o.id)
                                  }
                                }}
                                disabled={cancelMut.isPending}
                                title="Cancelar oferta"
                                className="sc-btn-ghost"
                                style={{ padding: 6 }}
                              >
                                <Trash2 className="w-3.5 h-3.5" style={{ color: 'var(--sc-text-low)' }} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {createOpen && (
        <CreateOfferModal
          onClose={() => setCreateOpen(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['offers'] })
            setCreateOpen(false)
          }}
        />
      )}
    </div>
  )
}

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({ onCreate, filter }: { onCreate: () => void; filter: StatusFilter }) {
  const isFiltered = filter !== 'all'
  return (
    <div className="text-center py-16">
      <Percent className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--sc-text-faint)' }} />
      <p style={{ color: 'var(--sc-text-low)', fontWeight: 500 }}>
        {isFiltered ? 'No hay ofertas en esta vista' : 'Sin ofertas configuradas'}
      </p>
      {!isFiltered && (
        <>
          <p style={{ color: 'var(--sc-text-faint)', fontSize: 12, marginTop: 8, maxWidth: 380, marginLeft: 'auto', marginRight: 'auto' }}>
            Crea ofertas por porcentaje de descuento sobre el precio calculado del marketplace. El sistema activa y expira automáticamente según las fechas.
          </p>
          <button
            onClick={onCreate}
            className="sc-btn-primary"
            style={{ padding: '8px 14px', fontSize: 12, marginTop: 16 }}
          >
            <Plus className="w-3.5 h-3.5" /> Crear primera oferta
          </button>
        </>
      )}
    </div>
  )
}

// ─── Create modal ────────────────────────────────────────────────────────────

function CreateOfferModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const queryClient = useQueryClient()
  const [productQuery, setProductQuery] = useState('')
  const [productId, setProductId] = useState<string | null>(null)
  const [productLabel, setProductLabel] = useState<string>('')
  const [productData, setProductData] = useState<any | null>(null)
  const [connectionId, setConnectionId] = useState<string>('')
  // Modo de descuento: porcentaje (%) o precio fijo (CLP).
  const [mode, setMode] = useState<'pct' | 'fixed'>('pct')
  const [discountPct, setDiscountPct] = useState<string>('15')
  const [fixedSalePrice, setFixedSalePrice] = useState<string>('')
  // Precio normal editable. Si el operador lo modifica, también se sobreescribe
  // marketplacePricing[provider].calculatedPrice en el maestro al crear.
  const [normalPrice, setNormalPrice] = useState<string>('')
  const [normalPriceTouched, setNormalPriceTouched] = useState(false)
  const today = new Date().toISOString().slice(0, 10)
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
  const [startDate, setStartDate] = useState<string>(today)
  const [endDate, setEndDate] = useState<string>(in30)
  const [notes, setNotes] = useState('')

  const { data: connections } = useQuery({
    queryKey: ['connections-for-offers'],
    queryFn: () => api.get('/connections').then((r) => r.data),
  })
  // Solo marketplaces con driver que soporte ofertas (hoy: falabella).
  const eligibleConnections = (connections || []).filter(
    (c: any) => c.type === 'marketplace' && c.provider === 'falabella',
  )

  // Reset producto al cambiar de marketplace (el listado se restringe).
  const onConnectionChange = (id: string) => {
    setConnectionId(id)
    setProductId(null)
    setProductLabel('')
    setProductData(null)
    setProductQuery('')
    setNormalPrice('')
    setNormalPriceTouched(false)
  }

  // Buscador filtrado: el endpoint /products acepta connectionId para
  // devolver solo productos con mapping activo en esa conexión. Lo
  // habilitamos apenas hay marketplace seleccionado para listar TODOS los
  // productos publicados (no requiere que el usuario escriba). Si escribe,
  // filtra. Pensado para casos con pocos productos donde el operador quiere
  // simplemente elegir uno de la lista.
  const { data: products, isLoading: loadingProducts } = useQuery({
    queryKey: ['products-search', productQuery, connectionId],
    queryFn: () =>
      api
        .get('/products', {
          params: {
            ...(productQuery.length >= 2 ? { search: productQuery } : {}),
            limit: 20,
            connectionId,
          },
        })
        .then((r) => r.data),
    enabled: !!connectionId,
  })

  // Cuando se selecciona un producto, prellenamos el precio normal con el
  // calculatedPrice del marketplace (o basePrice como fallback).
  const onSelectProduct = (p: any) => {
    setProductId(p.id)
    setProductLabel(p.name)
    setProductData(p)
    const conn = eligibleConnections.find((c: any) => c.id === connectionId)
    const pricing = (p.marketplacePricing || {}) as any
    const provPricing = conn ? pricing[conn.provider] : null
    const base = provPricing?.calculatedPrice || p.basePrice || 0
    setNormalPrice(String(Math.round(Number(base))))
    setNormalPriceTouched(false)
  }

  // Sincronización entre modo % y modo precio fijo: al cambiar uno, recalcula
  // el otro para que el preview siempre cuadre.
  const normalPriceNum = parseFloat(normalPrice) || 0
  const pctNum = parseFloat(discountPct) || 0
  const fixedNum = parseFloat(fixedSalePrice) || 0
  const previewSalePrice = (() => {
    if (!normalPriceNum) return null
    if (mode === 'pct') {
      if (pctNum <= 0 || pctNum >= 100) return null
      return Math.round(normalPriceNum * (1 - pctNum / 100))
    }
    if (fixedNum <= 0 || fixedNum >= normalPriceNum) return null
    return fixedNum
  })()
  const previewPct = (() => {
    if (mode === 'pct') return pctNum
    if (!normalPriceNum || !fixedNum || fixedNum >= normalPriceNum) return null
    return Math.round(((normalPriceNum - fixedNum) / normalPriceNum) * 100 * 100) / 100
  })()

  const createMut = useMutation({
    mutationFn: () => {
      const body: any = {
        productId,
        connectionId,
        startDate: new Date(`${startDate}T00:00:00`).toISOString(),
        endDate: new Date(`${endDate}T23:59:59`).toISOString(),
        notes: notes.trim() || undefined,
      }
      if (mode === 'pct') body.discountPct = pctNum
      else body.fixedSalePrice = fixedNum
      // Solo enviamos overrideCalculatedPrice si el operador modificó el
      // precio normal. Sin esto no tocamos el calculatedPrice del producto.
      if (normalPriceTouched && normalPriceNum > 0) {
        body.overrideCalculatedPrice = normalPriceNum
      }
      return api.post('/offers', body).then((r) => r.data)
    },
    onSuccess: () => {
      toast.success(
        normalPriceTouched
          ? 'Oferta creada · precio normal actualizado en la calculadora del producto'
          : 'Oferta creada (programada)',
      )
      onSuccess()
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Error al crear oferta'),
  })

  const canSubmit =
    productId &&
    connectionId &&
    normalPriceNum > 0 &&
    previewSalePrice !== null &&
    startDate &&
    endDate &&
    new Date(endDate) > new Date(startDate)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Panel style={{ width: '100%', maxWidth: 540 }}>
        <div
          className="flex items-center justify-between"
          style={{ padding: '14px 20px', borderBottom: '1px solid var(--sc-line-soft)' }}
        >
          <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--sc-text-hi)' }}>Nueva oferta</h2>
          <button onClick={onClose} className="sc-btn-ghost" style={{ padding: 4 }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div style={{ padding: 20, maxHeight: 'calc(90vh - 120px)', overflow: 'auto' }} className="space-y-4">
          {/* Marketplace */}
          <div>
            <Label>Marketplace</Label>
            <select
              value={connectionId}
              onChange={(e) => onConnectionChange(e.target.value)}
              className="sc-input"
              style={{ width: '100%' }}
            >
              <option value="">— Seleccionar —</option>
              {eligibleConnections.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {PROVIDER_LABELS[c.provider] || c.provider} ({c.name})
                </option>
              ))}
            </select>
            {eligibleConnections.length === 0 && (
              <Hint tone="warn">
                No hay conexiones marketplace que soporten ofertas. Conecta Falabella primero.
              </Hint>
            )}
          </div>

          {/* Producto — solo se habilita tras elegir marketplace */}
          <div>
            <Label>Producto disponible en el marketplace</Label>
            {!connectionId ? (
              <div
                className="sc-mono"
                style={{
                  padding: '10px 12px',
                  background: '#f3f4f6',
                  border: '1px solid var(--sc-line-soft)',
                  borderRadius: 8,
                  fontSize: 11,
                  color: 'var(--sc-text-low)',
                }}
              >
                Selecciona primero un marketplace para ver los productos publicados ahí.
              </div>
            ) : productId ? (
              <div
                className="flex items-center justify-between"
                style={{
                  padding: '10px 12px',
                  background: 'var(--sc-blue-50, #eff6ff)',
                  border: '1px solid var(--sc-blue-200, #bfdbfe)',
                  borderRadius: 8,
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--sc-text-hi)' }}>
                    {productLabel}
                  </div>
                  <div className="sc-mono" style={{ fontSize: 10, color: 'var(--sc-text-low)' }}>
                    SKU {productData?.sku || '—'}
                  </div>
                </div>
                <button
                  onClick={() => {
                    setProductId(null); setProductLabel(''); setProductData(null)
                    setProductQuery(''); setNormalPrice(''); setNormalPriceTouched(false)
                  }}
                  className="sc-btn-ghost"
                  style={{ padding: 4 }}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <>
                <input
                  value={productQuery}
                  onChange={(e) => setProductQuery(e.target.value)}
                  placeholder={`Filtrar... (${products?.meta?.total ?? 0} producto${products?.meta?.total === 1 ? '' : 's'} publicado${products?.meta?.total === 1 ? '' : 's'})`}
                  className="sc-input"
                  style={{ width: '100%' }}
                />
                <div
                  style={{
                    marginTop: 6,
                    border: '1px solid var(--sc-line-soft)',
                    borderRadius: 8,
                    maxHeight: 280,
                    overflow: 'auto',
                  }}
                >
                  {loadingProducts ? (
                    <div
                      style={{
                        padding: '14px 12px',
                        fontSize: 11,
                        color: 'var(--sc-text-low)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Cargando productos...
                    </div>
                  ) : (products?.data || []).length === 0 ? (
                    <div
                      style={{
                        padding: '14px 12px',
                        fontSize: 11,
                        color: 'var(--sc-text-low)',
                      }}
                    >
                      {productQuery.length >= 2
                        ? `Sin productos publicados en este marketplace que coincidan con "${productQuery}".`
                        : 'No hay productos publicados en este marketplace todavía. Publica al menos uno desde el módulo de Publicaciones.'}
                    </div>
                  ) : (
                    products.data.map((p: any) => {
                      const conn = eligibleConnections.find((c: any) => c.id === connectionId)
                      const pricing = (p.marketplacePricing || {}) as any
                      const calc = conn ? pricing[conn.provider]?.calculatedPrice : null
                      return (
                        <button
                          key={p.id}
                          onClick={() => onSelectProduct(p)}
                          className="w-full text-left"
                          style={{
                            padding: '10px 12px',
                            borderBottom: '1px solid var(--sc-line-faint)',
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = '#f9fafb')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                          <div style={{ fontSize: 12, color: 'var(--sc-text-hi)', fontWeight: 500 }}>
                            {p.name}
                          </div>
                          <div className="sc-mono" style={{ fontSize: 10, color: 'var(--sc-text-low)' }}>
                            SKU {p.sku} · precio mkt ${Number(calc || p.basePrice).toLocaleString('es-CL')}
                          </div>
                        </button>
                      )
                    })
                  )}
                </div>
              </>
            )}
          </div>

          {productId && (
            <>
              {/* Precio normal editable */}
              <div>
                <Label>Precio normal (calculadora del marketplace)</Label>
                <div className="flex items-center gap-2">
                  <span style={{ fontSize: 13, color: 'var(--sc-text-low)' }}>$</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={normalPrice}
                    onChange={(e) => { setNormalPrice(e.target.value); setNormalPriceTouched(true) }}
                    className="sc-input sc-mono"
                    style={{ width: 200 }}
                  />
                  {normalPriceTouched && (
                    <span
                      className="sc-mono"
                      style={{
                        fontSize: 10,
                        padding: '3px 8px',
                        borderRadius: 999,
                        background: '#fef3c7',
                        color: '#854d0e',
                      }}
                    >
                      modificado → se guardará en el maestro
                    </span>
                  )}
                </div>
                <div className="sc-mono" style={{ fontSize: 10, color: 'var(--sc-text-faint)', marginTop: 4 }}>
                  Sobreescribe `marketplacePricing.{eligibleConnections.find((c: any) => c.id === connectionId)?.provider || '...'}.calculatedPrice` del producto cuando guardes.
                </div>
              </div>

              {/* Toggle modo descuento */}
              <div>
                <Label>Tipo de oferta</Label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setMode('pct')}
                    style={{
                      padding: '8px 14px',
                      fontSize: 12,
                      borderRadius: 6,
                      border: '1px solid',
                      borderColor: mode === 'pct' ? 'var(--sc-blue-600)' : 'var(--sc-line-soft)',
                      background: mode === 'pct' ? 'var(--sc-blue-50, #eff6ff)' : 'transparent',
                      color: mode === 'pct' ? 'var(--sc-blue-700, #1d4ed8)' : 'var(--sc-text-mid)',
                      fontWeight: mode === 'pct' ? 600 : 400,
                      cursor: 'pointer',
                    }}
                  >
                    Por porcentaje (%)
                  </button>
                  <button
                    onClick={() => setMode('fixed')}
                    style={{
                      padding: '8px 14px',
                      fontSize: 12,
                      borderRadius: 6,
                      border: '1px solid',
                      borderColor: mode === 'fixed' ? 'var(--sc-blue-600)' : 'var(--sc-line-soft)',
                      background: mode === 'fixed' ? 'var(--sc-blue-50, #eff6ff)' : 'transparent',
                      color: mode === 'fixed' ? 'var(--sc-blue-700, #1d4ed8)' : 'var(--sc-text-mid)',
                      fontWeight: mode === 'fixed' ? 600 : 400,
                      cursor: 'pointer',
                    }}
                  >
                    Precio fijo (CLP)
                  </button>
                </div>
              </div>

              {/* Input descuento según modo */}
              {mode === 'pct' ? (
                <div>
                  <Label>Descuento (%)</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      max="99"
                      step="0.01"
                      value={discountPct}
                      onChange={(e) => setDiscountPct(e.target.value)}
                      className="sc-input sc-mono"
                      style={{ width: 120 }}
                    />
                    <span className="sc-mono" style={{ fontSize: 11, color: 'var(--sc-text-low)' }}>
                      %
                    </span>
                  </div>
                </div>
              ) : (
                <div>
                  <Label>Precio oferta (CLP)</Label>
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: 13, color: 'var(--sc-text-low)' }}>$</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={fixedSalePrice}
                      onChange={(e) => setFixedSalePrice(e.target.value)}
                      placeholder="Ej. 899990"
                      className="sc-input sc-mono"
                      style={{ width: 200 }}
                    />
                  </div>
                </div>
              )}

              {/* Preview en vivo */}
              {previewSalePrice !== null && (
                <div
                  style={{
                    padding: '12px 14px',
                    background: '#fef9c3',
                    border: '1px solid #fde68a',
                    borderRadius: 8,
                    fontSize: 13,
                    color: '#854d0e',
                  }}
                >
                  <div style={{ fontWeight: 600 }}>
                    Cliente verá ${previewSalePrice.toLocaleString('es-CL')}
                    {previewPct !== null && (
                      <span style={{ fontWeight: 400, marginLeft: 6, fontSize: 11 }}>
                        ({previewPct.toFixed(2)}% off)
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, marginTop: 4 }}>
                    Antes:{' '}
                    <span style={{ textDecoration: 'line-through' }}>
                      ${normalPriceNum.toLocaleString('es-CL')}
                    </span>
                    {' '}· ahorro $
                    {(normalPriceNum - previewSalePrice).toLocaleString('es-CL')}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Fechas */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Desde</Label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="sc-input"
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <Label>Hasta</Label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="sc-input"
                style={{ width: '100%' }}
              />
            </div>
          </div>

          {/* Notas */}
          <div>
            <Label>Notas (opcional)</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Ej. CyberDay, Liquidación stock, etc."
              className="sc-input"
              style={{ width: '100%', fontFamily: 'inherit' }}
            />
          </div>

          {/* Info */}
          <div
            style={{
              padding: 12,
              background: 'var(--sc-blue-50, #eff6ff)',
              border: '1px solid var(--sc-blue-200, #bfdbfe)',
              borderRadius: 8,
              fontSize: 11,
              color: 'var(--sc-blue-700, #1d4ed8)',
              display: 'flex',
              gap: 8,
              alignItems: 'flex-start',
            }}
          >
            <Calendar className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <div>
              La oferta se crea como <strong>programada</strong>. El scheduler la activa
              automáticamente al llegar la fecha de inicio (corre cada 15 min) y la expira
              cuando termina. Puedes activarla manualmente con el botón ▶ del listado.
            </div>
          </div>
        </div>

        <div
          className="flex justify-end gap-2"
          style={{ padding: '14px 20px', borderTop: '1px solid var(--sc-line-soft)' }}
        >
          <button onClick={onClose} className="sc-btn-ghost" style={{ padding: '8px 14px', fontSize: 12 }}>
            Cancelar
          </button>
          <button
            onClick={() => createMut.mutate()}
            disabled={!canSubmit || createMut.isPending}
            className="sc-btn-primary"
            style={{ padding: '8px 14px', fontSize: 12 }}
          >
            {createMut.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Crear oferta
          </button>
        </div>
      </Panel>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label
      className="sc-mono uppercase block"
      style={{ fontSize: 10, letterSpacing: '0.16em', color: 'var(--sc-text-low)', marginBottom: 6 }}
    >
      {children}
    </label>
  )
}

function Hint({ children, tone }: { children: React.ReactNode; tone: 'warn' | 'info' }) {
  const bg = tone === 'warn' ? '#fef3c7' : '#eff6ff'
  const border = tone === 'warn' ? '#fde68a' : '#bfdbfe'
  const color = tone === 'warn' ? '#854d0e' : '#1d4ed8'
  return (
    <div
      style={{
        marginTop: 6,
        padding: '8px 10px',
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 6,
        fontSize: 11,
        color,
      }}
    >
      {children}
    </div>
  )
}
