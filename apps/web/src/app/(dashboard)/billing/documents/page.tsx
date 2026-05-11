'use client'

import { Fragment, useState, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, FileText, Loader2, Eye, RefreshCw, Upload, ExternalLink, Layers, Download, ChevronRight, History } from 'lucide-react'
import { DatePicker } from '@/components/sc/date-picker'
import api from '@/lib/api'
import { Header } from '@/components/layout/header'
import { Panel, Chip, StatusBadge, MonoLabel } from '@/components/sc/ui'
import { formatCurrency, formatDate } from '@/lib/utils'
import { toast } from 'sonner'

type Filter = 'all' | 'issued' | 'pending' | 'failed' | 'cancelled'
type Situation = 'all' | 'mediation' | 'not_delivered' | 'cancelled_clean'

const STATUS_LABEL: Record<string, { label: string; tone: 'ok' | 'warn' | 'err' | 'low' | 'blue' }> = {
  issued: { label: 'Emitido', tone: 'ok' },
  pending: { label: 'En proceso', tone: 'warn' },
  failed: { label: 'Falló', tone: 'err' },
  cancelled: { label: 'Cancelado', tone: 'low' },
}

const TYPE_LABEL: Record<string, { label: string; tone: 'cyan' | 'low' | 'err' }> = {
  factura: { label: 'Factura', tone: 'cyan' },
  boleta: { label: 'Boleta', tone: 'low' },
  nota_credito: { label: 'NC', tone: 'err' },
}

// Deriva la "situación" del marketplace para una sale a partir de las orders
// que la componen. Hoy solo Mercado Libre llena metadata.tags / statusDetail /
// hasMediations (ver sync.service.ts buildOrderMetadata). Si cualquier order
// tiene mediación abierta, gana — esa es la señal más urgente. Si no, mostramos
// el motivo de cancelación (comprador/vendedor/ML) cuando ML lo expone.
// Devuelve null si no hay situación destacable.
function deriveSaleSituation(
  sale: any,
): { label: string; tone: 'warn' | 'err' } | null {
  const orders = Array.isArray(sale?.orders) ? sale.orders : []
  let mediation = false
  let claim = false
  let notDelivered = false
  let returned = false
  let anyCancelled = false
  let cancelledBy: 'buyer' | 'seller' | 'ml' | 'delivery' | null = null
  for (const o of orders) {
    const meta = (o.metadata || {}) as { statusDetail?: string; tags?: string[]; hasMediations?: boolean }
    const tags = Array.isArray(meta.tags) ? meta.tags : []
    const detail = meta.statusDetail || ''
    if (meta.hasMediations || detail === 'mediation_open') mediation = true
    if (tags.includes('claim_opened') || tags.includes('claim')) claim = true
    if (tags.includes('not_delivered') || detail === 'not_delivered') notDelivered = true
    if (tags.includes('return') || tags.includes('returned') || detail === 'returned') returned = true
    if (o.status === 'cancelled') anyCancelled = true
    if (detail === 'cancelled_by_buyer' && !cancelledBy) cancelledBy = 'buyer'
    else if (detail === 'cancelled_by_seller' && !cancelledBy) cancelledBy = 'seller'
    else if (detail === 'cancelled_by_ml' && !cancelledBy) cancelledBy = 'ml'
    else if (detail === 'cancelled_by_delivery' && !cancelledBy) cancelledBy = 'delivery'
  }
  if (mediation) return { label: 'En mediación', tone: 'warn' }
  if (claim) return { label: 'Con reclamo', tone: 'warn' }
  if (returned) return { label: 'Devuelto', tone: 'err' }
  if (cancelledBy === 'buyer') return { label: 'Cancelada por comprador', tone: 'err' }
  if (cancelledBy === 'seller') return { label: 'Cancelada por vendedor', tone: 'err' }
  if (cancelledBy === 'ml') return { label: 'Cancelada por ML', tone: 'err' }
  if (cancelledBy === 'delivery') return { label: 'Cancelada por logística', tone: 'err' }
  if (notDelivered && !anyCancelled) return { label: 'No entregado', tone: 'warn' }
  return null
}

// Agrupa los TaxDocuments por sale para mostrar una fila por venta. Una sale
// puede tener varios documentos a lo largo del tiempo (factura mal emitida
// → NC → boleta correcta → NC por cancelación) y verlos como filas
// independientes confunde al operador. Elegimos un "doc vigente" por venta
// con la siguiente prioridad descendente:
//   1) Boleta/factura issued más reciente (el "estado tributario activo")
//   2) Boleta/factura pending
//   3) Boleta/factura failed
//   4) Boleta/factura cancelled más reciente (todos anulados)
//   5) NC sola (caso raro: solo se importó la NC)
// Las filas "huérfanas" sin saleId (manual uploads sin sale) quedan cada una
// como su propio grupo.
type DocRow = {
  primary: any
  all: any[]
  saleNumber: string | null
  saleId: string | null
  hasHistory: boolean
}
function groupDocsBySale(docs: any[]): DocRow[] {
  const groups = new Map<string, any[]>()
  const orphans: any[] = []
  for (const d of docs) {
    const sid = d.saleId || d.sale?.id
    if (!sid) { orphans.push(d); continue }
    const arr = groups.get(sid) || []
    arr.push(d)
    groups.set(sid, arr)
  }
  const pickPrimary = (items: any[]): any => {
    const sortByCreatedDesc = (a: any, b: any) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    const issued = items.filter((d) => (d.type === 'boleta' || d.type === 'factura') && d.status === 'issued').sort(sortByCreatedDesc)
    if (issued.length > 0) return issued[0]
    const pending = items.filter((d) => (d.type === 'boleta' || d.type === 'factura') && d.status === 'pending').sort(sortByCreatedDesc)
    if (pending.length > 0) return pending[0]
    const failed = items.filter((d) => (d.type === 'boleta' || d.type === 'factura') && d.status === 'failed').sort(sortByCreatedDesc)
    if (failed.length > 0) return failed[0]
    const cancelled = items.filter((d) => (d.type === 'boleta' || d.type === 'factura') && d.status === 'cancelled').sort(sortByCreatedDesc)
    if (cancelled.length > 0) return cancelled[0]
    return items.slice().sort(sortByCreatedDesc)[0]
  }
  const rows: DocRow[] = []
  for (const [saleId, items] of groups) {
    const sorted = items.slice().sort(
      (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    const primary = pickPrimary(items)
    rows.push({
      primary,
      all: sorted,
      saleNumber: primary?.sale?.saleNumber || null,
      saleId,
      hasHistory: items.length > 1,
    })
  }
  for (const d of orphans) {
    rows.push({ primary: d, all: [d], saleNumber: null, saleId: null, hasHistory: false })
  }
  // Orden estable de las filas: por fecha del primary descendente (la API ya
  // devuelve docs ordenados, pero al colapsar puede haber primary más viejo
  // que algún otro de su grupo — re-ordenamos por createdAt del primary).
  rows.sort((a, b) =>
    new Date(b.primary.createdAt).getTime() - new Date(a.primary.createdAt).getTime(),
  )
  return rows
}

export default function TaxDocumentsPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [situation, setSituation] = useState<Situation>('all')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [placedFrom, setPlacedFrom] = useState('')
  const [placedTo, setPlacedTo] = useState('')

  const buildParams = () => {
    const p: Record<string, any> = { search, page, limit: 20 }
    if (filter !== 'all') p.status = filter
    if (situation !== 'all') p.situation = situation
    if (placedFrom) p.placedFrom = placedFrom
    if (placedTo) p.placedTo = placedTo
    return p
  }

  const { data, isLoading } = useQuery({
    queryKey: ['tax-documents', search, filter, situation, page, placedFrom, placedTo],
    queryFn: () => api.get('/tax-documents', { params: buildParams() }).then((r) => r.data),
  })

  const handleExportCsv = async () => {
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (filter !== 'all') params.set('status', filter)
    if (situation !== 'all') params.set('situation', situation)
    if (placedFrom) params.set('placedFrom', placedFrom)
    if (placedTo) params.set('placedTo', placedTo)
    try {
      const res = await api.get(`/tax-documents/export.csv?${params.toString()}`, {
        responseType: 'blob',
      })
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `tax-documents-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success('CSV descargado')
    } catch (err: any) {
      toast.error('Error al exportar')
    }
  }

  const retryMutation = useMutation({
    mutationFn: (id: string) => api.post(`/tax-documents/${id}/retry`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tax-documents'] })
      toast.success('Reintento encolado')
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Error al reintentar'),
  })

  // Estado del modal de emisión de NC manual. Guardamos el doc completo para
  // mostrar contexto al operador antes de confirmar (folio, tipo, monto).
  const [ncTarget, setNcTarget] = useState<any | null>(null)
  const creditNoteMutation = useMutation({
    mutationFn: (vars: { saleId: string; motive: string }) =>
      api.post(`/tax-documents/credit-note/sale/${vars.saleId}`, { motive: vars.motive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tax-documents'] })
      toast.success('Nota de crédito emitida')
      setNcTarget(null)
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.message || 'Error al emitir nota de crédito'),
  })

  const docs = data?.data || []
  const meta = data?.meta
  const rows = useMemo(() => groupDocsBySale(docs), [docs])
  const [expandedSales, setExpandedSales] = useState(new Set<string>())
  const toggleExpand = (saleId: string) => {
    setExpandedSales((prev) => {
      const next = new Set(prev)
      if (next.has(saleId)) next.delete(saleId)
      else next.add(saleId)
      return next
    })
  }

  const tabs: { key: Filter; label: string }[] = [
    { key: 'all', label: 'Todos' },
    { key: 'issued', label: 'Emitidos' },
    { key: 'pending', label: 'En proceso' },
    { key: 'failed', label: 'Fallidos' },
    { key: 'cancelled', label: 'Cancelados' },
  ]

  return (
    <div className="flex flex-col h-full">
      <Header
        breadcrumbs={['CONSOLA', 'FACTURACIÓN', 'DOCUMENTOS']}
        title="Documentos tributarios"
        subtitle={
          meta
            ? `${rows.length} venta${rows.length === 1 ? '' : 's'} · ${meta.total} documento${meta.total === 1 ? '' : 's'} · agrupado por venta`
            : 'Boletas, facturas y notas de crédito emitidas'
        }
        actions={
          <div className="flex gap-2">
            <button
              onClick={handleExportCsv}
              className="sc-btn-ghost"
              style={{ padding: '8px 14px', fontSize: 12 }}
              title="Descargar CSV con los filtros actuales"
            >
              <Download className="w-3.5 h-3.5" /> Exportar CSV
            </button>
            <button
              onClick={() => setUploadOpen(true)}
              className="sc-btn-ghost"
              style={{ padding: '8px 14px', fontSize: 12 }}
            >
              <Upload className="w-3.5 h-3.5" /> Subir manual
            </button>
          </div>
        }
      />

      <div className="flex-1 px-7 py-6 overflow-auto">
        <Panel className="overflow-hidden">
          <div
            className="flex flex-wrap items-center gap-3"
            style={{ padding: 16, borderBottom: '1px solid var(--sc-line-soft)' }}
          >
            <div className="relative" style={{ minWidth: 280, flex: '1 1 280px' }}>
              <Search
                className="w-3.5 h-3.5 absolute"
                style={{ left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--sc-text-low)' }}
              />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                placeholder="Buscar por folio, venta, RUT, nombre, email u order ID…"
                className="sc-input"
                style={{ paddingLeft: 38 }}
              />
            </div>
            <div className="flex items-center gap-2">
              <span
                className="sc-mono uppercase"
                style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--sc-text-low)' }}
              >
                Venta desde
              </span>
              <DatePicker
                value={placedFrom}
                onChange={(v) => { setPlacedFrom(v); setPage(1) }}
                className="sc-input"
                style={{ width: 160 }}
              />
              <span
                className="sc-mono uppercase"
                style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--sc-text-low)' }}
              >
                Hasta
              </span>
              <DatePicker
                value={placedTo}
                onChange={(v) => { setPlacedTo(v); setPage(1) }}
                className="sc-input"
                style={{ width: 160 }}
              />
              {(placedFrom || placedTo) && (
                <button
                  onClick={() => { setPlacedFrom(''); setPlacedTo(''); setPage(1) }}
                  className="sc-btn-ghost"
                  style={{ padding: '6px 10px', fontSize: 11 }}
                >
                  Limpiar
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span
                className="sc-mono uppercase"
                style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--sc-text-low)' }}
              >
                Situación
              </span>
              <select
                value={situation}
                onChange={(e) => { setSituation(e.target.value as Situation); setPage(1) }}
                className="sc-input"
                style={{ width: 180, fontSize: 12 }}
              >
                <option value="all">Todas</option>
                <option value="mediation">En mediación</option>
                <option value="not_delivered">No entregadas</option>
                <option value="cancelled_clean">Canceladas (limpias)</option>
              </select>
            </div>
          </div>

          <div
            className="flex gap-1 overflow-x-auto"
            style={{ padding: '0 16px', borderBottom: '1px solid var(--sc-line-soft)' }}
          >
            {tabs.map((tab) => {
              const active = filter === tab.key
              return (
                <button
                  key={tab.key}
                  onClick={() => { setFilter(tab.key); setPage(1) }}
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
          ) : docs.length === 0 ? (
            <div className="text-center py-16">
              <FileText className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--sc-text-faint)' }} />
              <p style={{ color: 'var(--sc-text-low)', fontWeight: 500 }}>No hay documentos en esta vista</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    {['TIPO', 'FOLIO', 'VENTA', 'CLIENTE', 'TOTAL', 'EMISOR', 'ESTADO', 'FECHA VENTA', ''].map((h, i) => (
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
                  {rows.map((row) => {
                    const doc = row.primary
                    const typeInfo = TYPE_LABEL[doc.type] || { label: doc.type, tone: 'low' as const }
                    const statusInfo = STATUS_LABEL[doc.status] || { label: doc.status, tone: 'low' as const }
                    const isExpanded = row.saleId ? expandedSales.has(row.saleId) : false
                    const historyExtras = row.all.filter((d) => d.id !== doc.id)
                    // El botón "Emitir NC" aparece cuando el doc vigente es
                    // boleta/factura issued, el emisor es Bsale (los demás
                    // ml-external/manual no soportan NC automática) y no hay
                    // ya una NC issued/pending que apunte a este doc.
                    const canEmitCreditNote =
                      doc.emitter === 'bsale' &&
                      (doc.type === 'boleta' || doc.type === 'factura') &&
                      doc.status === 'issued' &&
                      !row.all.some(
                        (d) => d.type === 'nota_credito' &&
                               (d.status === 'issued' || d.status === 'pending') &&
                               d.referenceDocumentId === doc.id,
                      )
                    return (
                      <Fragment key={row.saleId || doc.id}>
                        <tr className="sc-row">
                          <td style={{ padding: '13px 16px', borderBottom: '1px solid var(--sc-line-faint)' }}>
                            <div className="flex items-center gap-2">
                              {row.hasHistory && row.saleId ? (
                                <button
                                  onClick={() => toggleExpand(row.saleId!)}
                                  aria-label={isExpanded ? 'Colapsar historial' : 'Ver historial'}
                                  title={`Ver los ${row.all.length} movimientos de esta venta`}
                                  style={{
                                    padding: 2,
                                    background: 'transparent',
                                    border: 'none',
                                    color: 'var(--sc-text-low)',
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                  }}
                                >
                                  <ChevronRight
                                    className="w-3.5 h-3.5"
                                    style={{
                                      transform: isExpanded ? 'rotate(90deg)' : 'none',
                                      transition: 'transform .15s',
                                    }}
                                  />
                                </button>
                              ) : (
                                <span style={{ width: 14, display: 'inline-block' }} />
                              )}
                              <Chip tone={typeInfo.tone}>{typeInfo.label}</Chip>
                              {row.hasHistory && (
                                <span
                                  title={`Con ${row.all.length - 1} movimiento${row.all.length === 2 ? '' : 's'} adicional${row.all.length === 2 ? '' : 'es'}`}
                                  className="sc-mono"
                                  style={{
                                    fontSize: 10,
                                    padding: '2px 6px',
                                    borderRadius: 999,
                                    background: 'rgba(245,158,11,0.10)',
                                    color: '#b45309',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 3,
                                  }}
                                >
                                  <History className="w-2.5 h-2.5" />{row.all.length}
                                </span>
                              )}
                            </div>
                          </td>
                          <td
                            className="sc-mono"
                            style={{
                              padding: '13px 16px',
                              color: 'var(--sc-text-hi)',
                              fontWeight: 500,
                              borderBottom: '1px solid var(--sc-line-faint)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {doc.folio || <span style={{ color: 'var(--sc-text-faint)' }}>—</span>}
                          </td>
                          <td
                            className="sc-mono"
                            style={{
                              padding: '13px 16px',
                              color: 'var(--sc-blue-600)',
                              borderBottom: '1px solid var(--sc-line-faint)',
                            }}
                          >
                            {doc.sale?.saleNumber || '—'}
                          </td>
                          <td
                            style={{
                              padding: '13px 16px',
                              color: 'var(--sc-text-mid)',
                              borderBottom: '1px solid var(--sc-line-faint)',
                            }}
                          >
                            <div>{doc.sale?.customerName || '—'}</div>
                            {(() => {
                              const sit = deriveSaleSituation(doc.sale)
                              return sit ? (
                                <div style={{ marginTop: 3 }}>
                                  <Chip tone={sit.tone}>{sit.label}</Chip>
                                </div>
                              ) : null
                            })()}
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
                            {doc.sale?.total
                              ? formatCurrency(Number(doc.sale.total), 'CLP')
                              : '—'}
                          </td>
                          <td style={{ padding: '13px 16px', borderBottom: '1px solid var(--sc-line-faint)' }}>
                            <EmitterBadge emitter={doc.emitter} />
                          </td>
                          <td style={{ padding: '13px 16px', borderBottom: '1px solid var(--sc-line-faint)' }}>
                            <StatusBadge tone={statusInfo.tone}>{statusInfo.label}</StatusBadge>
                            {doc.status === 'failed' && doc.attempts && (
                              <p
                                className="sc-mono"
                                style={{ fontSize: 10, color: 'var(--sc-text-faint)', marginTop: 2 }}
                              >
                                {doc.attempts} intento{doc.attempts === 1 ? '' : 's'}
                              </p>
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
                            {doc.sale?.placedAt
                              ? formatDate(doc.sale.placedAt)
                              : doc.sale?.createdAt
                                ? formatDate(doc.sale.createdAt)
                                : doc.emittedAt
                                  ? formatDate(doc.emittedAt)
                                  : '—'}
                          </td>
                          <td style={{ padding: '13px 16px', borderBottom: '1px solid var(--sc-line-faint)' }}>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => setSelectedId(doc.id)}
                                className="sc-btn-ghost"
                                style={{ padding: 6 }}
                                aria-label="Ver detalle"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                              {doc.pdfUrl && (
                                <a
                                  href={doc.pdfUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="sc-btn-ghost"
                                  style={{ padding: 6 }}
                                  aria-label="Ver PDF"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                              )}
                              {doc.status === 'failed' && (
                                <button
                                  onClick={() => retryMutation.mutate(doc.id)}
                                  disabled={retryMutation.isPending}
                                  style={{
                                    padding: '5px 10px',
                                    fontSize: 11,
                                    color: 'var(--sc-blue-600)',
                                    borderRadius: 6,
                                    background: 'transparent',
                                    border: '1px solid rgba(37,99,235,0.20)',
                                    cursor: 'pointer',
                                    transition: 'background .15s',
                                  }}
                                >
                                  <RefreshCw className="w-3 h-3 inline mr-1" /> Reintentar
                                </button>
                              )}
                              {canEmitCreditNote && (
                                <button
                                  onClick={() => setNcTarget(doc)}
                                  title="Emitir nota de crédito total que anula este documento en Bsale + SII"
                                  style={{
                                    padding: '5px 10px',
                                    fontSize: 11,
                                    color: '#b91c1c',
                                    borderRadius: 6,
                                    background: 'transparent',
                                    border: '1px solid rgba(220,38,38,0.20)',
                                    cursor: 'pointer',
                                    transition: 'background .15s',
                                  }}
                                >
                                  Emitir NC
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {isExpanded && historyExtras.map((h: any) => {
                          const hType = TYPE_LABEL[h.type] || { label: h.type, tone: 'low' as const }
                          const hStatus = STATUS_LABEL[h.status] || { label: h.status, tone: 'low' as const }
                          return (
                            <tr
                              key={h.id}
                              style={{ background: 'rgba(243,244,246,0.45)' }}
                            >
                              <td style={{ padding: '10px 16px 10px 42px', borderBottom: '1px solid var(--sc-line-faint)' }}>
                                <Chip tone={hType.tone}>{hType.label}</Chip>
                              </td>
                              <td
                                className="sc-mono"
                                style={{
                                  padding: '10px 16px',
                                  color: 'var(--sc-text-mid)',
                                  borderBottom: '1px solid var(--sc-line-faint)',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {h.folio || <span style={{ color: 'var(--sc-text-faint)' }}>—</span>}
                              </td>
                              <td style={{ borderBottom: '1px solid var(--sc-line-faint)' }} />
                              <td style={{ borderBottom: '1px solid var(--sc-line-faint)' }} />
                              <td style={{ borderBottom: '1px solid var(--sc-line-faint)' }} />
                              <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--sc-line-faint)' }}>
                                <EmitterBadge emitter={h.emitter} />
                              </td>
                              <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--sc-line-faint)' }}>
                                <StatusBadge tone={hStatus.tone}>{hStatus.label}</StatusBadge>
                              </td>
                              <td
                                className="sc-mono"
                                style={{
                                  padding: '10px 16px',
                                  fontSize: 11,
                                  color: 'var(--sc-text-low)',
                                  borderBottom: '1px solid var(--sc-line-faint)',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {h.createdAt ? formatDate(h.createdAt) : '—'}
                              </td>
                              <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--sc-line-faint)' }}>
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => setSelectedId(h.id)}
                                    className="sc-btn-ghost"
                                    style={{ padding: 6 }}
                                    aria-label="Ver detalle"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                  </button>
                                  {h.pdfUrl && (
                                    <a
                                      href={h.pdfUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="sc-btn-ghost"
                                      style={{ padding: 6 }}
                                      aria-label="Ver PDF"
                                    >
                                      <ExternalLink className="w-3.5 h-3.5" />
                                    </a>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {meta && meta.totalPages > 1 && (
            <div
              className="flex items-center justify-between"
              style={{ padding: '14px 20px', borderTop: '1px solid var(--sc-line-soft)' }}
            >
              <p className="sc-mono" style={{ fontSize: 11, color: 'var(--sc-text-low)', letterSpacing: '0.14em' }}>
                {meta.total} DOCUMENTOS · PÁGINA {meta.page} DE {meta.totalPages}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => p - 1)}
                  disabled={!meta.hasPrevPage}
                  className="sc-btn-ghost"
                  style={{ padding: '6px 14px', fontSize: 12 }}
                >
                  Anterior
                </button>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!meta.hasNextPage}
                  className="sc-btn-ghost"
                  style={{ padding: '6px 14px', fontSize: 12 }}
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </Panel>
      </div>

      {selectedId && (
        <DocDetailModal id={selectedId} onClose={() => setSelectedId(null)} />
      )}

      {uploadOpen && (
        <UploadModal
          onClose={() => setUploadOpen(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['tax-documents'] })
            setUploadOpen(false)
          }}
        />
      )}

      {ncTarget && (
        <CreditNoteModal
          doc={ncTarget}
          isPending={creditNoteMutation.isPending}
          onCancel={() => setNcTarget(null)}
          onConfirm={(motive) =>
            creditNoteMutation.mutate({ saleId: ncTarget.saleId, motive })
          }
        />
      )}
    </div>
  )
}

// Modal de confirmación de NC manual. Pide motivo (texto libre, requerido),
// muestra el doc original y avisa que la NC anula totalmente el documento.
function CreditNoteModal({
  doc,
  isPending,
  onCancel,
  onConfirm,
}: {
  doc: any
  isPending: boolean
  onCancel: () => void
  onConfirm: (motive: string) => void
}) {
  const [motive, setMotive] = useState('Cancelación de la orden')
  const typeLabel = doc.type === 'factura' ? 'factura' : 'boleta'
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Panel style={{ width: '100%', maxWidth: 480 }}>
        <div
          className="flex items-center justify-between"
          style={{ padding: '14px 20px', borderBottom: '1px solid var(--sc-line-soft)' }}
        >
          <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--sc-text-hi)' }}>
            Emitir nota de crédito
          </h2>
          <button onClick={onCancel} className="sc-btn-ghost" style={{ padding: 4 }} aria-label="Cerrar">
            <span style={{ fontSize: 18, lineHeight: 1 }}>×</span>
          </button>
        </div>
        <div style={{ padding: 20 }}>
          <div
            style={{
              padding: 12,
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 8,
              marginBottom: 16,
              fontSize: 12,
              color: '#991b1b',
            }}
          >
            Esto emite una <strong>NC total</strong> en Bsale sobre la {typeLabel}{' '}
            <strong className="sc-mono">folio {doc.folio || '—'}</strong> de la venta{' '}
            <strong className="sc-mono">{doc.sale?.saleNumber || '—'}</strong>. La NC se declara al SII y anula contablemente el documento. No se puede deshacer.
          </div>

          <label
            className="sc-mono uppercase block"
            style={{ fontSize: 10, letterSpacing: '0.16em', color: 'var(--sc-text-low)', marginBottom: 6 }}
          >
            Motivo
          </label>
          <textarea
            value={motive}
            onChange={(e) => setMotive(e.target.value)}
            rows={3}
            placeholder="Ej. Cancelación por comprador, producto no entregado, error en el monto…"
            className="sc-input"
            style={{ width: '100%', fontFamily: 'inherit' }}
          />

          <div className="flex justify-end gap-2" style={{ marginTop: 16 }}>
            <button
              type="button"
              onClick={onCancel}
              className="sc-btn-ghost"
              style={{ padding: '8px 14px', fontSize: 12 }}
              disabled={isPending}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => onConfirm(motive.trim() || 'Cancelación de la orden')}
              disabled={isPending}
              style={{
                padding: '8px 14px',
                fontSize: 12,
                fontWeight: 500,
                color: 'white',
                background: '#dc2626',
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Emitir NC
            </button>
          </div>
        </div>
      </Panel>
    </div>
  )
}

function DocDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const { data: doc, isLoading } = useQuery({
    queryKey: ['tax-document', id],
    queryFn: () => api.get(`/tax-documents/${id}`).then((r) => r.data),
  })

  const convert = useMutation({
    mutationFn: (saleId: string) =>
      api.post(`/tax-documents/convert-to-factura/sale/${saleId}`).then((r) => r.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tax-documents'] })
      queryClient.invalidateQueries({ queryKey: ['tax-document', id] })
      toast.success(
        data?.alreadyConverted
          ? 'La venta ya tenía factura emitida'
          : 'Boleta convertida a factura',
      )
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.message || 'Error al convertir'),
  })

  if (isLoading || !doc) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <Loader2 className="w-8 h-8 animate-spin text-white" />
      </div>
    )
  }

  const typeInfo = TYPE_LABEL[doc.type] || { label: doc.type, tone: 'low' as const }
  const statusInfo = STATUS_LABEL[doc.status] || { label: doc.status, tone: 'low' as const }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(11,31,63,0.5)', backdropFilter: 'blur(4px)' }}
    >
      <Panel className="w-full max-w-2xl flex flex-col" style={{ maxHeight: '90vh' }}>
        <div
          className="flex items-start justify-between flex-shrink-0"
          style={{ padding: 24, borderBottom: '1px solid var(--sc-line-soft)' }}
        >
          <div>
            <MonoLabel tone="blue">// TAX_DOCUMENT.DETAIL</MonoLabel>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <Chip tone={typeInfo.tone}>{typeInfo.label}</Chip>
              <h2
                className="sc-mono"
                style={{ fontSize: 18, fontWeight: 600, color: 'var(--sc-text-hi)' }}
              >
                {doc.folio || '—'}
              </h2>
              <StatusBadge tone={statusInfo.tone}>{statusInfo.label}</StatusBadge>
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <EmitterBadge emitter={doc.emitter} />
              <span className="sc-mono" style={{ fontSize: 11, color: 'var(--sc-text-low)' }}>
                {doc.emittedAt ? formatDate(doc.emittedAt) : 'no emitido'}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              color: 'var(--sc-text-low)',
              fontSize: 24,
              lineHeight: 1,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-4" style={{ padding: 24 }}>
          {doc.sale && (
            <Panel className="sc-panel-flat" style={{ padding: 16, background: '#f7f9fd', boxShadow: 'none' }}>
              <MonoLabel>VENTA VINCULADA</MonoLabel>
              <p className="sc-mono mt-2" style={{ fontSize: 14, color: 'var(--sc-blue-600)', fontWeight: 500 }}>
                {doc.sale.saleNumber}
              </p>
              <p style={{ fontSize: 13, color: 'var(--sc-text-mid)', marginTop: 2 }}>
                {doc.sale.customerName}
              </p>
              {(() => {
                const sit = deriveSaleSituation(doc.sale)
                return sit ? (
                  <div style={{ marginTop: 6 }}>
                    <Chip tone={sit.tone}>{sit.label}</Chip>
                  </div>
                ) : null
              })()}
              {doc.sale.total && (
                <p className="sc-mono" style={{ fontSize: 13, color: 'var(--sc-text-hi)', fontWeight: 600, marginTop: 4 }}>
                  {formatCurrency(Number(doc.sale.total), doc.sale.currency || 'CLP')}
                </p>
              )}
            </Panel>
          )}

          {doc.lastError && (
            <Panel className="sc-panel-flat" style={{ padding: 16, background: 'rgba(220,38,38,0.05)', boxShadow: 'none' }}>
              <MonoLabel tone="err">// LAST_ERROR</MonoLabel>
              <p
                className="sc-mono"
                style={{
                  fontSize: 12,
                  color: 'var(--sc-err)',
                  marginTop: 6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {doc.lastError}
              </p>
              <p
                className="sc-mono"
                style={{ fontSize: 11, color: 'var(--sc-text-low)', marginTop: 4 }}
              >
                Intentos: {doc.attempts}
              </p>
            </Panel>
          )}

          {doc.lines && doc.lines.length > 0 && (
            <div>
              <MonoLabel>LÍNEAS</MonoLabel>
              <Panel className="overflow-hidden mt-2">
                <table className="w-full" style={{ fontSize: 12 }}>
                  <thead>
                    <tr>
                      {['Producto', 'SKU', 'Cant.', 'Neto unit.'].map((h) => (
                        <th
                          key={h}
                          className="sc-mono text-left uppercase"
                          style={{
                            padding: '8px 12px',
                            fontSize: 10,
                            letterSpacing: '0.16em',
                            color: 'var(--sc-text-low)',
                            background: '#f7f9fd',
                            borderBottom: '1px solid var(--sc-line-soft)',
                            fontWeight: 500,
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {doc.lines.map((line: any) => (
                      <tr key={line.id}>
                        <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--sc-line-faint)' }}>
                          {line.name}
                        </td>
                        <td
                          className="sc-mono"
                          style={{ padding: '8px 12px', color: 'var(--sc-text-low)', borderBottom: '1px solid var(--sc-line-faint)' }}
                        >
                          {line.sku}
                        </td>
                        <td
                          className="sc-mono"
                          style={{ padding: '8px 12px', borderBottom: '1px solid var(--sc-line-faint)' }}
                        >
                          {Number(line.quantity)}
                        </td>
                        <td
                          className="sc-mono"
                          style={{ padding: '8px 12px', borderBottom: '1px solid var(--sc-line-faint)' }}
                        >
                          {formatCurrency(Number(line.netUnitValue), 'CLP')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            </div>
          )}

          {doc.creditNotes && doc.creditNotes.length > 0 && (
            <Panel className="sc-panel-flat" style={{ padding: 16, background: 'rgba(220,38,38,0.04)', boxShadow: 'none' }}>
              <MonoLabel tone="err">// NOTAS DE CRÉDITO ASOCIADAS</MonoLabel>
              <div className="mt-2 space-y-1">
                {doc.creditNotes.map((nc: any) => (
                  <div key={nc.id} className="flex items-center gap-2 text-xs">
                    <Layers className="w-3 h-3" />
                    <span className="sc-mono">{nc.folio || nc.id.slice(0, 8)}</span>
                    <span style={{ color: 'var(--sc-text-low)' }}>·</span>
                    <span style={{ color: 'var(--sc-text-mid)' }}>
                      {nc.emittedAt ? formatDate(nc.emittedAt) : 'pendiente'}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {doc.reference && (
            <Panel className="sc-panel-flat" style={{ padding: 16, background: '#f7f9fd', boxShadow: 'none' }}>
              <MonoLabel>DOCUMENTO ORIGINAL (esta NC se aplica a)</MonoLabel>
              <p className="sc-mono mt-2" style={{ fontSize: 13, color: 'var(--sc-blue-600)' }}>
                {doc.reference.folio || doc.reference.id.slice(0, 8)} · {TYPE_LABEL[doc.reference.type]?.label}
              </p>
            </Panel>
          )}

          <div className="flex gap-2 flex-wrap">
            {doc.pdfUrl && (
              <a
                href={doc.pdfUrl}
                target="_blank"
                rel="noreferrer"
                className="sc-btn-ghost"
                style={{ padding: '8px 14px', fontSize: 12 }}
              >
                <ExternalLink className="w-3.5 h-3.5" /> Abrir PDF
              </a>
            )}
            {doc.xmlUrl && (
              <a
                href={doc.xmlUrl}
                target="_blank"
                rel="noreferrer"
                className="sc-btn-ghost"
                style={{ padding: '8px 14px', fontSize: 12 }}
              >
                <ExternalLink className="w-3.5 h-3.5" /> Abrir XML
              </a>
            )}
            {doc.type === 'boleta' && doc.status === 'issued' && doc.saleId && (
              <button
                onClick={() => convert.mutate(doc.saleId)}
                disabled={convert.isPending}
                className="sc-btn-ghost"
                style={{ padding: '8px 14px', fontSize: 12, color: 'var(--sc-blue-600)' }}
              >
                {convert.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Convertir a factura
              </button>
            )}
            {doc.externalId && (
              <span
                className="sc-mono"
                style={{
                  fontSize: 11,
                  color: 'var(--sc-text-low)',
                  padding: '8px 14px',
                  border: '1px solid var(--sc-line-soft)',
                  borderRadius: 6,
                }}
              >
                ID externo: {doc.externalId}
              </span>
            )}
          </div>
        </div>
      </Panel>
    </div>
  )
}

function UploadModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void
  onSuccess: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [saleId, setSaleId] = useState('')
  const [type, setType] = useState<'boleta' | 'factura' | 'nota_credito'>('boleta')
  const [folio, setFolio] = useState('')

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('saleId', saleId)
      fd.append('type', type)
      if (folio) fd.append('folio', folio)
      const res = await api.post('/tax-documents/upload-manual', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      return res.data
    },
    onSuccess: () => {
      toast.success('Documento registrado')
      onSuccess()
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Error al subir'),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file) {
      toast.error('Selecciona un PDF')
      return
    }
    if (!saleId.trim()) {
      toast.error('ID de venta requerido')
      return
    }
    upload.mutate(file)
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(11,31,63,0.5)', backdropFilter: 'blur(4px)' }}
    >
      <Panel className="w-full max-w-md flex flex-col">
        <div
          className="flex items-start justify-between"
          style={{ padding: 20, borderBottom: '1px solid var(--sc-line-soft)' }}
        >
          <div>
            <MonoLabel tone="blue">// UPLOAD.MANUAL</MonoLabel>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--sc-text-hi)', marginTop: 4 }}>
              Subir documento manual
            </h2>
            <p style={{ fontSize: 12, color: 'var(--sc-text-low)', marginTop: 2 }}>
              Para documentos emitidos fuera del sistema (legacy o fallback).
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', fontSize: 24, color: 'var(--sc-text-low)', cursor: 'pointer' }}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4" style={{ padding: 20 }}>
          <Field label="ID de venta (saleId)">
            <input
              value={saleId}
              onChange={(e) => setSaleId(e.target.value)}
              placeholder="uuid de la Sale"
              className="sc-input"
              required
            />
          </Field>

          <Field label="Tipo">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as any)}
              className="sc-input"
            >
              <option value="boleta">Boleta</option>
              <option value="factura">Factura</option>
              <option value="nota_credito">Nota de crédito</option>
            </select>
          </Field>

          <Field label="Folio (opcional)">
            <input
              value={folio}
              onChange={(e) => setFolio(e.target.value)}
              placeholder="ej. 12345"
              className="sc-input"
            />
          </Field>

          <Field label="PDF">
            <input ref={fileRef} type="file" accept="application/pdf" required className="sc-input" />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="sc-btn-ghost" style={{ padding: '8px 14px', fontSize: 12 }}>
              Cancelar
            </button>
            <button
              type="submit"
              disabled={upload.isPending}
              className="sc-btn-primary"
              style={{ padding: '8px 14px', fontSize: 12 }}
            >
              {upload.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Subir
            </button>
          </div>
        </form>
      </Panel>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label
        className="sc-mono uppercase block"
        style={{
          fontSize: 10,
          letterSpacing: '0.16em',
          color: 'var(--sc-text-low)',
          marginBottom: 6,
        }}
      >
        {label}
      </label>
      {children}
    </div>
  )
}

// Distingue visualmente el origen del documento:
//   - bsale: emitido desde StockCentral con Bsale (sistema interno).
//   - manual: subido por el operador a mano (PDF de fuera del sistema).
//   - ml-external: existía ya en ML cuando importamos el histórico.
//   - otros: muestra el nombre tal cual.
function EmitterBadge({ emitter }: { emitter: string }) {
  const meta: Record<string, { label: string; tone: 'ok' | 'low' | 'warn' | 'cyan'; title?: string }> = {
    bsale: { label: 'Bsale', tone: 'ok', title: 'Emitido desde StockCentral con Bsale' },
    manual: { label: 'Manual', tone: 'cyan', title: 'PDF subido manualmente al sistema' },
    'ml-external': {
      label: 'Cargado por otro medio',
      tone: 'warn',
      title: 'Existe en Mercado Libre pero NO fue emitido por StockCentral. Se importó del histórico.',
    },
  }
  const m = meta[emitter] || { label: emitter, tone: 'low' as const }
  return (
    <span title={m.title}>
      <Chip tone={m.tone}>{m.label}</Chip>
    </span>
  )
}
