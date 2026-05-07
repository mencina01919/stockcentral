'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, Warehouse, Loader2, AlertTriangle } from 'lucide-react'
import api from '@/lib/api'
import { Header } from '@/components/layout/header'
import { Panel, MonoLabel, Chip, StatusBadge } from '@/components/sc/ui'

export default function InventoryPage() {
  const [search, setSearch] = useState('')
  const [showLowStock, setShowLowStock] = useState(false)
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['inventory', search, showLowStock, page],
    queryFn: () =>
      api.get('/inventory', {
        params: { search, lowStock: showLowStock ? 'true' : undefined, page, limit: 20 },
      }).then((r) => r.data),
  })

  const { data: alertsData } = useQuery({
    queryKey: ['inventory-alerts'],
    queryFn: () => api.get('/inventory/alerts').then((r) => r.data),
  })

  const items = data?.data || []
  const meta = data?.meta
  const alerts = alertsData || []

  return (
    <div className="flex flex-col h-full">
      <Header
        breadcrumbs={['CONSOLA', 'INVENTARIO']}
        title="Inventario centralizado"
        subtitle={meta ? `${meta.total} registros · sincronizado en tiempo real` : 'Gestión de stock centralizado'}
      />

      <div className="flex-1 px-7 py-6 overflow-auto space-y-5">
        {alerts.length > 0 && (
          <Panel
            className="flex items-center gap-4"
            style={{
              padding: '16px 20px',
              borderColor: 'rgba(217,119,6,0.25)',
              background: 'linear-gradient(180deg, rgba(217,119,6,0.06), rgba(217,119,6,0.02))',
            }}
          >
            <div
              className="flex items-center justify-center flex-shrink-0"
              style={{
                width: 38,
                height: 38,
                borderRadius: 8,
                background: 'rgba(217,119,6,0.10)',
                border: '1px solid rgba(217,119,6,0.30)',
              }}
            >
              <AlertTriangle className="w-[18px] h-[18px]" style={{ color: 'var(--sc-warn)' }} />
            </div>
            <div className="flex-1 min-w-0">
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--sc-text-hi)' }}>
                {alerts.length} producto{alerts.length > 1 ? 's' : ''} requiere{alerts.length > 1 ? 'n' : ''} atención
              </div>
              <div style={{ fontSize: 12, color: 'var(--sc-text-mid)', marginTop: 2 }}>
                Revisa el stock bajo umbral mínimo o sin disponibilidad
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {alerts.slice(0, 3).map((a: any) => (
                <Chip key={a.id} tone={a.quantity === 0 ? 'err' : 'warn'}>
                  {a.product?.sku} · {a.quantity}u
                </Chip>
              ))}
              {alerts.length > 3 && <Chip tone="warn">+{alerts.length - 3} más</Chip>}
            </div>
          </Panel>
        )}

        <Panel className="overflow-hidden">
          <div
            className="flex items-center gap-4"
            style={{ padding: 16, borderBottom: '1px solid var(--sc-line-soft)' }}
          >
            <div className="relative flex-1 max-w-sm">
              <Search
                className="w-3.5 h-3.5 absolute"
                style={{ left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--sc-text-low)' }}
              />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                placeholder="Buscar por SKU, nombre o EAN…"
                className="sc-input"
                style={{ paddingLeft: 38 }}
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showLowStock}
                onChange={(e) => { setShowLowStock(e.target.checked); setPage(1) }}
                style={{ accentColor: 'var(--sc-blue-600)' }}
              />
              <span style={{ fontSize: 13, color: 'var(--sc-text-mid)' }}>Solo bajo stock</span>
            </label>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--sc-blue-500)' }} />
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-16">
              <Warehouse className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--sc-text-faint)' }} />
              <p style={{ color: 'var(--sc-text-low)' }}>No hay registros de inventario</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    {['Producto', 'SKU', 'Bodega', 'Stock', 'Reservado', 'Disponible', 'Mínimo', 'Estado'].map((h) => (
                      <th
                        key={h}
                        className="sc-mono uppercase text-left"
                        style={{
                          padding: '12px 16px',
                          fontSize: 10.5,
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
                  {items.map((item: any) => (
                    <tr
                      key={item.id}
                      className="sc-row"
                      style={item.isLowStock ? { background: 'rgba(217,119,6,0.04)' } : undefined}
                    >
                      <td
                        style={{
                          padding: '13px 16px',
                          color: 'var(--sc-text-hi)',
                          fontWeight: 500,
                          borderBottom: '1px solid var(--sc-line-faint)',
                        }}
                      >
                        {item.product?.name}
                      </td>
                      <td
                        className="sc-mono"
                        style={{
                          padding: '13px 16px',
                          color: 'var(--sc-text-mid)',
                          fontSize: 12,
                          borderBottom: '1px solid var(--sc-line-faint)',
                        }}
                      >
                        {item.product?.sku}
                      </td>
                      <td
                        style={{
                          padding: '13px 16px',
                          color: 'var(--sc-text-mid)',
                          borderBottom: '1px solid var(--sc-line-faint)',
                        }}
                      >
                        {item.warehouse?.name}
                      </td>
                      <td
                        className="sc-mono"
                        style={{
                          padding: '13px 16px',
                          fontWeight: 600,
                          color:
                            item.quantity === 0
                              ? 'var(--sc-err)'
                              : item.isLowStock
                              ? 'var(--sc-warn)'
                              : 'var(--sc-text-hi)',
                          borderBottom: '1px solid var(--sc-line-faint)',
                        }}
                      >
                        {item.quantity}
                      </td>
                      <td
                        className="sc-mono"
                        style={{
                          padding: '13px 16px',
                          color: 'var(--sc-text-low)',
                          borderBottom: '1px solid var(--sc-line-faint)',
                        }}
                      >
                        {item.reservedQuantity}
                      </td>
                      <td
                        className="sc-mono"
                        style={{
                          padding: '13px 16px',
                          color: 'var(--sc-text-mid)',
                          fontWeight: 500,
                          borderBottom: '1px solid var(--sc-line-faint)',
                        }}
                      >
                        {item.availableQuantity}
                      </td>
                      <td
                        className="sc-mono"
                        style={{
                          padding: '13px 16px',
                          color: 'var(--sc-text-faint)',
                          borderBottom: '1px solid var(--sc-line-faint)',
                        }}
                      >
                        {item.minStock}
                      </td>
                      <td style={{ padding: '13px 16px', borderBottom: '1px solid var(--sc-line-faint)' }}>
                        {item.isOutOfStock ? (
                          <StatusBadge tone="err">SIN STOCK</StatusBadge>
                        ) : item.isLowStock ? (
                          <StatusBadge tone="warn">STOCK BAJO</StatusBadge>
                        ) : (
                          <StatusBadge tone="ok">OK</StatusBadge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {meta && meta.totalPages > 1 && (
            <div
              className="flex items-center justify-between"
              style={{
                padding: '14px 20px',
                borderTop: '1px solid var(--sc-line-soft)',
              }}
            >
              <p className="sc-mono" style={{ fontSize: 11, color: 'var(--sc-text-low)', letterSpacing: '0.14em' }}>
                {meta.total} REGISTROS · PÁGINA {meta.page} DE {meta.totalPages}
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
    </div>
  )
}
