'use client'

import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Search, RefreshCw, X, Edit, Package } from 'lucide-react'
import api from '@/lib/api'
import { Panel, MonoLabel, Chip } from '@/components/sc/ui'
import { ImageUploader } from '@/components/sc/image-uploader'
import { ImageGrid } from '@/components/sc/image-grid'
import { formatCurrency } from '@/lib/utils'
import { toast } from 'sonner'

export function ProductEditModal({ product, onClose, onSuccess }: { product: any; onClose: () => void; onSuccess: () => void }) {
  const getStockByType = (type: string) => {
    const inv = product.inventory?.find((i: any) => i.warehouse?.warehouseType === type)
    return String(inv?.quantity ?? 0)
  }
  const [form, setForm] = useState({
    name: product.name || '',
    barcode: product.barcode || '',
    brand: product.brand || '',
    description: product.description || '',
    basePrice: String(product.basePrice || ''),
    costPrice: String(product.costPrice || ''),
    transferPrice: String(product.transferPrice || ''),
    salePrice: String(product.salePrice || ''),
    targetMargin: String(product.targetMargin || ''),
    saleStartDate: product.saleStartDate || '',
    saleEndDate: product.saleEndDate || '',
    stockOnline: getStockByType('online'),
    stockWarehouse: getStockByType('warehouse'),
    stockStore: getStockByType('store'),
    status: product.status || 'active',
    images: ((product.images as string[] | null) || []).join('\n'),
  })
  const [saving, setSaving] = useState(false)
  const [pushing, setPushing] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      const imageList = form.images.split('\n').map((s) => s.trim()).filter(Boolean)
      await api.patch(`/products/${product.id}`, {
        name: form.name,
        // Empty string clears the barcode in DB; non-empty saves it.
        barcode: form.barcode.trim(),
        brand: form.brand || undefined,
        description: form.description || undefined,
        basePrice: Number(form.basePrice),
        costPrice: form.costPrice ? Number(form.costPrice) : undefined,
        transferPrice: form.transferPrice ? Number(form.transferPrice) : undefined,
        salePrice: form.salePrice ? Number(form.salePrice) : undefined,
        targetMargin: form.targetMargin ? Number(form.targetMargin) : undefined,
        saleStartDate: form.saleStartDate || undefined,
        saleEndDate: form.saleEndDate || undefined,
        stockOnline: Number(form.stockOnline),
        stockWarehouse: Number(form.stockWarehouse),
        stockStore: Number(form.stockStore),
        status: form.status,
        images: imageList,
      })
      toast.success('Producto actualizado')
      onSuccess()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Error al actualizar')
    } finally {
      setSaving(false)
    }
  }

  const handlePush = async () => {
    await handleSave()
    setPushing(true)
    try {
      const result = await api.post(`/products/${product.id}/push`)
      const results = result.data.results as any[]
      if (results.length === 0) {
        toast.info('No hay canales conectados para sincronizar')
      } else {
        const ok = results.filter((r) => r.success).length
        const fail = results.filter((r) => !r.success).length
        if (fail === 0) toast.success(`Sincronizado en ${ok} canal${ok > 1 ? 'es' : ''}`)
        else toast.warning(`${ok} canales OK, ${fail} con error`)
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Error al sincronizar')
    } finally {
      setPushing(false)
    }
  }

  const imageList = form.images.split('\n').map((s) => s.trim()).filter(Boolean)

  const totalStock =
    (Number(form.stockOnline) || 0) +
    (Number(form.stockWarehouse) || 0) +
    (Number(form.stockStore) || 0)
  const calculatedMargin =
    form.costPrice && form.basePrice && Number(form.basePrice) > 0
      ? ((1 - Number(form.costPrice) / Number(form.basePrice)) * 100).toFixed(1)
      : null

  const STATUS_CHIP: Record<string, { tone: 'ok' | 'warn' | 'low' | 'err'; label: string }> = {
    active: { tone: 'ok', label: 'ACTIVO' },
    out_of_stock: { tone: 'err', label: 'AGOTADO' },
    coming_soon: { tone: 'warn', label: 'PRÓXIMAMENTE' },
    unavailable: { tone: 'low', label: 'NO DISPONIBLE' },
  }
  const statusChip = STATUS_CHIP[form.status] || STATUS_CHIP.active

  return (
    <div className="fixed inset-0 z-50 flex flex-col sc-grid-bg">
      {/* Topbar */}
      <header
        className="flex items-center justify-between flex-shrink-0"
        style={{
          padding: '16px 28px',
          borderBottom: '1px solid var(--sc-line-soft)',
          background: 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(8px)',
        }}
      >
        <div className="flex items-center gap-4 min-w-0">
          <button
            onClick={onClose}
            className="sc-btn-ghost"
            style={{ padding: 9 }}
            title="Volver al listado"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <p
              className="sc-mono uppercase"
              style={{
                fontSize: 11,
                letterSpacing: '0.14em',
                color: 'var(--sc-text-low)',
                marginBottom: 4,
              }}
            >
              CONSOLA{' '}
              <span style={{ margin: '0 8px', color: 'var(--sc-text-faint)' }}>/</span>
              PRODUCTOS{' '}
              <span style={{ margin: '0 8px', color: 'var(--sc-text-faint)' }}>/</span>
              <span style={{ color: 'var(--sc-blue-600)' }}>EDITAR</span>
            </p>
            <div className="flex items-center gap-3">
              <h2
                style={{
                  fontSize: 18,
                  fontWeight: 600,
                  color: 'var(--sc-text-hi)',
                  letterSpacing: '-0.01em',
                  margin: 0,
                }}
                className="truncate"
              >
                {form.name || 'Editar producto'}
              </h2>
              <Chip tone="blue">{product.sku}</Chip>
              <Chip tone={statusChip.tone}>{statusChip.label}</Chip>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleSave}
            disabled={saving || pushing}
            className="sc-btn-ghost"
            style={{
              padding: '8px 14px',
              fontSize: 12,
              color: 'var(--sc-blue-700)',
              borderColor: 'rgba(59,130,246,0.30)',
            }}
          >
            {saving && !pushing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Guardar
          </button>
          <button
            onClick={handlePush}
            disabled={saving || pushing}
            className="sc-btn-primary"
            style={{ padding: '8px 14px', fontSize: 12 }}
          >
            {pushing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Guardar y sincronizar
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto relative">
        <div className="sc-glow" style={{ left: '20%' }} />
        <div
          className="relative mx-auto grid grid-cols-1 lg:grid-cols-3 gap-5"
          style={{ maxWidth: 1280, padding: '24px 28px' }}
        >
          <div className="lg:col-span-2 space-y-5">
            {/* Resumen */}
            <Panel className="grid grid-cols-1 sm:grid-cols-3 gap-0 overflow-hidden">
              <div
                style={{
                  padding: 18,
                  borderRight: '1px solid var(--sc-line-faint)',
                }}
              >
                <MonoLabel>STOCK TOTAL</MonoLabel>
                <div
                  className="sc-mono mt-2"
                  style={{
                    fontSize: 26,
                    fontWeight: 600,
                    color: 'var(--sc-text-hi)',
                    fontFeatureSettings: '"tnum"',
                    letterSpacing: '-0.02em',
                  }}
                >
                  {totalStock.toLocaleString('es-CL')}
                </div>
                <p style={{ fontSize: 11, color: 'var(--sc-text-low)' }}>unidades</p>
              </div>
              <div
                style={{
                  padding: 18,
                  borderRight: '1px solid var(--sc-line-faint)',
                }}
              >
                <MonoLabel>PRECIO BASE</MonoLabel>
                <div
                  className="sc-mono mt-2"
                  style={{
                    fontSize: 26,
                    fontWeight: 600,
                    color: 'var(--sc-text-hi)',
                    fontFeatureSettings: '"tnum"',
                    letterSpacing: '-0.02em',
                  }}
                >
                  ${(Number(form.basePrice) || 0).toLocaleString('es-CL')}
                </div>
                <p style={{ fontSize: 11, color: 'var(--sc-text-low)' }}>CLP</p>
              </div>
              <div style={{ padding: 18 }}>
                <MonoLabel>MARGEN</MonoLabel>
                <div
                  className="sc-mono mt-2"
                  style={{
                    fontSize: 26,
                    fontWeight: 600,
                    color: calculatedMargin
                      ? Number(calculatedMargin) >= 30
                        ? 'var(--sc-ok)'
                        : Number(calculatedMargin) >= 15
                        ? 'var(--sc-warn)'
                        : 'var(--sc-err)'
                      : 'var(--sc-text-faint)',
                    fontFeatureSettings: '"tnum"',
                    letterSpacing: '-0.02em',
                  }}
                >
                  {calculatedMargin ? `${calculatedMargin}%` : '—'}
                </div>
                <p style={{ fontSize: 11, color: 'var(--sc-text-low)' }}>
                  costo vs precio base
                </p>
              </div>
            </Panel>

            {/* Identidad */}
            <Panel style={{ padding: 24 }}>
              <MonoLabel tone="blue">// PRODUCT.IDENTITY</MonoLabel>
              <h3
                className="mt-1 mb-5"
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: 'var(--sc-text-hi)',
                  letterSpacing: '-0.01em',
                }}
              >
                Identidad
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <MonoLabel>NOMBRE DEL PRODUCTO</MonoLabel>
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Ej: Monitor MSI MAG 271QP QD-OLED 27'' 240Hz"
                    className="sc-input mt-1.5"
                  />
                </div>
                <div>
                  <MonoLabel>MARCA</MonoLabel>
                  <input
                    value={form.brand}
                    onChange={(e) => setForm({ ...form, brand: e.target.value })}
                    placeholder="Ej: MSI, Samsung"
                    className="sc-input mt-1.5"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                <div>
                  <MonoLabel>SKU</MonoLabel>
                  <input
                    value={product.sku}
                    readOnly
                    className="sc-input sc-mono mt-1.5"
                    style={{ background: '#f7f9fd', color: 'var(--sc-text-mid)', cursor: 'not-allowed' }}
                  />
                  <p style={{ fontSize: 11, color: 'var(--sc-text-low)', marginTop: 6 }}>
                    Identificador interno · no se puede modificar.
                  </p>
                </div>
                <div>
                  <MonoLabel>
                    CÓDIGO DE BARRAS{' '}
                    <span style={{ color: 'var(--sc-text-faint)', fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>
                      opcional
                    </span>
                  </MonoLabel>
                  <input
                    value={form.barcode}
                    onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                    placeholder="Ej: 7804609001234 (UPC, EAN, GTIN)"
                    className="sc-input sc-mono mt-1.5"
                  />
                  <p style={{ fontSize: 11, color: 'var(--sc-text-low)', marginTop: 6 }}>
                    UPC-12, EAN-13, EAN-8, GTIN-14 o ISBN. Vacío para borrar.
                  </p>
                </div>
              </div>

              <div className="mt-4">
                <MonoLabel>DESCRIPCIÓN</MonoLabel>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={5}
                  placeholder="Especificaciones técnicas, materiales, compatibilidad y usos recomendados…"
                  className="sc-input mt-1.5 resize-none"
                />
                <p style={{ fontSize: 11, color: 'var(--sc-text-low)', marginTop: 6 }}>
                  Se publica en la ficha del producto en Falabella. Sin HTML.
                </p>
              </div>
            </Panel>

            {/* Precios */}
            <Panel style={{ padding: 24 }}>
              <MonoLabel tone="blue">// PRICING</MonoLabel>
              <h3
                className="mt-1 mb-5"
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: 'var(--sc-text-hi)',
                  letterSpacing: '-0.01em',
                }}
              >
                Precios
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <MonoLabel>PRECIO COSTO (CLP)</MonoLabel>
                  <input
                    type="number"
                    value={form.costPrice}
                    onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
                    min="0"
                    placeholder="Ej: 250000"
                    className="sc-input mt-1.5"
                  />
                </div>
                <div>
                  <MonoLabel>PRECIO TRANSFERENCIA (CLP)</MonoLabel>
                  <input
                    type="number"
                    value={form.transferPrice}
                    onChange={(e) => setForm({ ...form, transferPrice: e.target.value })}
                    min="0"
                    placeholder="Ej: 300000"
                    className="sc-input mt-1.5"
                  />
                </div>
                <div>
                  <MonoLabel>PRECIO BASE (CLP)</MonoLabel>
                  <input
                    type="number"
                    value={form.basePrice}
                    onChange={(e) => setForm({ ...form, basePrice: e.target.value })}
                    min="0"
                    placeholder="Ej: 599990"
                    className="sc-input mt-1.5"
                  />
                </div>
                <div>
                  <MonoLabel>
                    MARGEN OBJETIVO (%){' '}
                    {calculatedMargin && <span style={{ color: 'var(--sc-blue-600)' }}>· auto {calculatedMargin}%</span>}
                  </MonoLabel>
                  <input
                    type="number"
                    value={form.targetMargin}
                    onChange={(e) => setForm({ ...form, targetMargin: e.target.value })}
                    placeholder={calculatedMargin ? `Auto: ${calculatedMargin}%` : 'Ej: 40'}
                    className="sc-input mt-1.5"
                  />
                </div>
                <div className="sm:col-span-2">
                  <MonoLabel>
                    PRECIO OFERTA (CLP){' '}
                    <span style={{ color: 'var(--sc-text-faint)' }}>opcional</span>
                  </MonoLabel>
                  <input
                    type="number"
                    value={form.salePrice}
                    onChange={(e) => setForm({ ...form, salePrice: e.target.value })}
                    min="0"
                    placeholder="Dejar vacío si no hay oferta"
                    className="sc-input mt-1.5"
                  />
                </div>
              </div>

              {form.salePrice && (
                <div
                  className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4"
                  style={{
                    padding: 16,
                    background: 'rgba(59,130,246,0.05)',
                    border: '1px dashed rgba(59,130,246,0.25)',
                    borderRadius: 10,
                  }}
                >
                  <div>
                    <MonoLabel tone="blue">INICIO DE OFERTA</MonoLabel>
                    <input
                      type="date"
                      value={form.saleStartDate}
                      onChange={(e) => setForm({ ...form, saleStartDate: e.target.value })}
                      className="sc-input mt-1.5"
                    />
                    <p style={{ fontSize: 11, color: 'var(--sc-text-low)', marginTop: 6 }}>
                      Activa el precio de oferta en Falabella.
                    </p>
                  </div>
                  <div>
                    <MonoLabel tone="blue">FIN DE OFERTA</MonoLabel>
                    <input
                      type="date"
                      value={form.saleEndDate}
                      onChange={(e) => setForm({ ...form, saleEndDate: e.target.value })}
                      className="sc-input mt-1.5"
                    />
                    <p style={{ fontSize: 11, color: 'var(--sc-text-low)', marginTop: 6 }}>
                      Después vuelve al precio base.
                    </p>
                  </div>
                </div>
              )}
            </Panel>

            {/* Inventario */}
            <Panel style={{ padding: 24 }}>
              <MonoLabel tone="blue">// INVENTORY.STATE</MonoLabel>
              <h3
                className="mt-1 mb-5"
                style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: 'var(--sc-text-hi)',
                  letterSpacing: '-0.01em',
                }}
              >
                Inventario y estado
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  { label: 'STOCK ONLINE', key: 'stockOnline', hint: 'Ecommerce propio', accent: '#3b82f6' },
                  { label: 'STOCK BODEGA', key: 'stockWarehouse', hint: 'Bodega principal', accent: '#1d4ed8' },
                  { label: 'STOCK TIENDA', key: 'stockStore', hint: 'Tienda física', accent: '#22d3ee' },
                ].map(({ label, key, hint, accent }) => (
                  <div
                    key={key}
                    style={{
                      padding: 14,
                      borderRadius: 10,
                      background: '#f7f9fd',
                      border: '1px solid var(--sc-line-faint)',
                      position: 'relative',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: 3,
                        background: accent,
                      }}
                    />
                    <MonoLabel>{label}</MonoLabel>
                    <input
                      type="number"
                      value={(form as any)[key]}
                      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                      min="0"
                      className="sc-input mt-2"
                    />
                    <p style={{ fontSize: 11, color: 'var(--sc-text-low)', marginTop: 6 }}>
                      {hint}
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-5">
                <MonoLabel>ESTADO DEL PRODUCTO</MonoLabel>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="sc-input mt-1.5"
                  style={{ maxWidth: 280 }}
                >
                  <option value="active">Activo</option>
                  <option value="out_of_stock">Agotado</option>
                  <option value="coming_soon">Próximamente</option>
                  <option value="unavailable">No disponible</option>
                </select>
              </div>
            </Panel>

            {/* Imágenes */}
            <Panel style={{ padding: 24 }}>
              <div className="flex items-start justify-between gap-3 mb-1">
                <div>
                  <MonoLabel tone="blue">// MEDIA.IMAGES</MonoLabel>
                  <h3
                    className="mt-1"
                    style={{
                      fontSize: 16,
                      fontWeight: 600,
                      color: 'var(--sc-text-hi)',
                      letterSpacing: '-0.01em',
                    }}
                  >
                    Imágenes del producto
                  </h3>
                </div>
                <ImageUploader
                  disabled={saving || pushing}
                  onUploaded={(url) => {
                    setForm((prev) => ({
                      ...prev,
                      images: prev.images.trim() ? `${prev.images.trim()}\n${url}` : url,
                    }))
                  }}
                />
              </div>
              <p style={{ fontSize: 12, color: 'var(--sc-text-mid)', margin: '4px 0 16px' }}>
                Sube imágenes desde tu equipo o pega URLs externas (una por línea).
                Se usan las primeras 8.
              </p>

              {imageList.length > 0 && (
                <div className="mb-4">
                  <ImageGrid
                    urls={imageList}
                    disabled={saving || pushing}
                    onChange={(next) => setForm({ ...form, images: next.join('\n') })}
                  />
                  <p
                    className="sc-mono"
                    style={{
                      fontSize: 10,
                      color: 'var(--sc-text-faint)',
                      letterSpacing: '0.16em',
                      marginTop: 8,
                    }}
                  >
                    ⇄ ARRASTRA PARA REORDENAR · LA PRIMERA ES LA PRINCIPAL
                  </p>
                </div>
              )}

              <MonoLabel>URLS DE IMÁGENES (UNA POR LÍNEA)</MonoLabel>
              <textarea
                value={form.images}
                onChange={(e) => setForm({ ...form, images: e.target.value })}
                rows={4}
                placeholder={'https://mitienda.com/img/producto-frente.jpg\nhttps://mitienda.com/img/producto-lateral.jpg'}
                className="sc-input sc-mono mt-1.5 resize-none"
                style={{ fontSize: 12 }}
              />
              <ul
                style={{
                  marginTop: 10,
                  fontSize: 11,
                  color: 'var(--sc-text-low)',
                  listStyle: 'none',
                  padding: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <li>
                  <span style={{ color: 'var(--sc-blue-600)' }}>▸</span> La{' '}
                  <strong style={{ color: 'var(--sc-text-mid)' }}>primera URL</strong> será la imagen principal en
                  Falabella.
                </li>
                <li>
                  <span style={{ color: 'var(--sc-blue-600)' }}>▸</span> Las URLs deben ser{' '}
                  <strong style={{ color: 'var(--sc-text-mid)' }}>públicamente accesibles</strong>.
                </li>
                <li>
                  <span style={{ color: 'var(--sc-blue-600)' }}>▸</span> JPG/PNG · mínimo 800×800px · fondo blanco
                  recomendado.
                </li>
              </ul>
              {imageList.length > 8 && (
                <p style={{ fontSize: 11, color: 'var(--sc-warn)', marginTop: 8 }}>
                  Solo se usarán las primeras 8 imágenes.
                </p>
              )}
            </Panel>
          </div>

          {/* Aside */}
          <aside className="lg:col-span-1 space-y-5">
            <Panel style={{ padding: 22 }}>
              <MarketplaceSyncBlock productId={product.id} sku={product.sku} />
            </Panel>
            <Panel style={{ padding: 22 }}>
              <MarketplacePricingBlock product={product} />
            </Panel>
            <Panel style={{ padding: 22 }}>
              <ParisConfigBlock product={product} />
            </Panel>
          </aside>
        </div>
      </div>
    </div>
  )
}

// Modal: lista publicaciones del marketplace con búsqueda para vincular manualmente
function MarketplaceProductPicker({
  productId, connectionId, providerLabel, onClose, onLinked,
}: {
  productId: string
  connectionId: string
  providerLabel: string
  onClose: () => void
  onLinked: () => void
}) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [linking, setLinking] = useState<string | null>(null)
  const limit = 25

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1) }, 400)
    return () => clearTimeout(t)
  }, [search])

  const { data, isLoading, error } = useQuery({
    queryKey: ['mp-picker', connectionId, page, debouncedSearch],
    queryFn: () => api.get(`/products/marketplace/${connectionId}`, {
      params: {
        offset: (page - 1) * limit,
        limit,
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
      },
    }).then(r => r.data),
  })

  const items: any[] = data?.data || []
  const meta = data?.meta

  const link = async (externalId: string, marketplaceSku: string, price: number, title: string) => {
    setLinking(externalId)
    try {
      await api.post(`/products/${productId}/marketplaces/${connectionId}/link`, {
        externalId, marketplaceSku, price, title,
      })
      toast.success(`Vinculado: ${title || externalId}`)
      onLinked()
      onClose()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Error al vincular')
    } finally {
      setLinking(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">Buscar publicación en {providerLabel}</p>
            <p className="text-xs text-gray-500 mt-0.5">Selecciona la publicación que corresponde a este producto del maestro.</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Buscador */}
        <div className="px-5 py-3 border-b border-gray-100">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              autoFocus
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nombre, SKU o ID de publicación…"
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
          {meta && (
            <p className="text-xs text-gray-400 mt-2">
              {items.length} resultados de {meta.total} {debouncedSearch ? 'coincidentes' : 'totales'}
            </p>
          )}
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-sky-500" />
            </div>
          ) : error ? (
            <div className="text-center py-12 text-sm text-amber-700">
              No se pudieron cargar publicaciones desde {providerLabel}
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12">
              <Package className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">
                {debouncedSearch
                  ? `Sin resultados para "${debouncedSearch}"`
                  : 'No hay publicaciones en este marketplace'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {items.map(p => {
                const isLinked = !!p.mapping
                const isLinking = linking === p.externalId
                return (
                  <div key={p.externalId} className="px-5 py-3 flex items-center gap-3 hover:bg-gray-50">
                    {p.images?.[0] && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.images[0]} alt="" className="w-12 h-12 object-cover rounded border border-gray-200 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{p.title || '(sin título)'}</p>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500">
                        <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">{p.externalId}</span>
                        {p.externalSku && (
                          <span className="font-mono">SKU: {p.externalSku}</span>
                        )}
                        {p.price && (
                          <span className="font-medium text-gray-700">{formatCurrency(Number(p.price))}</span>
                        )}
                        <span className={
                          p.status === 'active' ? 'text-green-600' :
                          p.status === 'paused' ? 'text-amber-600' :
                          p.status === 'closed' ? 'text-gray-400' : ''
                        }>· {p.status}</span>
                      </div>
                      {isLinked && (
                        <p className="text-xs text-amber-700 mt-0.5">Ya vinculado a otro producto del maestro</p>
                      )}
                    </div>
                    <button
                      onClick={() => link(p.externalId, p.externalSku || '', Number(p.price || 0), p.title || '')}
                      disabled={isLinking}
                      className="px-3 py-1.5 text-xs bg-sky-600 hover:bg-sky-700 text-white rounded-md font-medium transition-colors flex items-center gap-1 disabled:opacity-50"
                    >
                      {isLinking ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                      {isLinked ? 'Re-vincular' : 'Vincular'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Paginación */}
        {meta && meta.total > limit && (
          <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
            <p className="text-xs text-gray-500">Página {page}</p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => p - 1)}
                disabled={page === 1}
                className="px-3 py-1 text-xs border border-gray-200 rounded-md disabled:opacity-40 hover:bg-gray-50"
              >
                Anterior
              </button>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={!meta.hasMore}
                className="px-3 py-1 text-xs border border-gray-200 rounded-md disabled:opacity-40 hover:bg-gray-50"
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function MarketplaceSyncBlock({ productId, sku }: { productId: string; sku: string }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const [picker, setPicker] = useState<{ connectionId: string; providerLabel: string } | null>(null)

  const { data: status, isLoading } = useQuery<any[]>({
    queryKey: ['product-marketplaces', productId],
    queryFn: () => api.get(`/products/${productId}/marketplaces`).then((r) => r.data),
  })

  const detect = async (connectionId: string) => {
    setBusy(connectionId)
    try {
      const res = await api.post(`/products/${productId}/marketplaces/${connectionId}/detect`)
      const r = res.data
      if (r.status === 'connected') toast.success(`Vinculado: ${r.title || r.marketplaceProductId}`)
      else if (r.status === 'sku_not_found') toast.warning('SKU no encontrado en este marketplace')
      else if (r.status === 'sku_duplicate') toast.error(`SKU duplicado (${r.matched} publicaciones)`)
      queryClient.invalidateQueries({ queryKey: ['product-marketplaces', productId] })
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Error al detectar')
    } finally {
      setBusy(null)
    }
  }

  const unlink = async (connectionId: string) => {
    setBusy(connectionId)
    try {
      await api.delete(`/products/${productId}/marketplaces/${connectionId}`)
      toast.success('Desvinculado')
      queryClient.invalidateQueries({ queryKey: ['product-marketplaces', productId] })
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Error al desvincular')
    } finally {
      setBusy(null)
    }
  }

  if (isLoading) {
    return (
      <div
        className="flex items-center justify-center"
        style={{
          background: '#f7f9fd',
          border: '1px solid var(--sc-line-faint)',
          borderRadius: 10,
          padding: 16,
        }}
      >
        <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--sc-text-low)' }} />
      </div>
    )
  }

  if (!status || status.length === 0) {
    return (
      <div>
        <MonoLabel tone="blue">// MARKETPLACE.SYNC</MonoLabel>
        <h3
          className="mt-1 mb-3"
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--sc-text-hi)',
            letterSpacing: '-0.01em',
          }}
        >
          Sincronización con marketplaces
        </h3>
        <div
          style={{
            background: '#f7f9fd',
            border: '1px dashed var(--sc-line-soft)',
            borderRadius: 10,
            padding: 14,
            fontSize: 12,
            color: 'var(--sc-text-low)',
          }}
        >
          No hay conexiones de marketplace configuradas. Crea una en Conexiones.
        </div>
      </div>
    )
  }

  const STATUS_TONE: Record<string, { tone: 'ok' | 'warn' | 'err' | 'low'; label: string }> = {
    connected: { tone: 'ok', label: 'VINCULADO' },
    sku_not_found: { tone: 'warn', label: 'SIN COINCIDENCIA' },
    sku_duplicate: { tone: 'err', label: 'SKU DUPLICADO' },
    unlinked: { tone: 'low', label: 'NO VINCULADO' },
    pending: { tone: 'low', label: 'PENDIENTE' },
  }

  return (
    <div>
      <MonoLabel tone="blue">// MARKETPLACE.SYNC</MonoLabel>
      <h3
        className="mt-1"
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--sc-text-hi)',
          letterSpacing: '-0.01em',
        }}
      >
        Sincronización con marketplaces
      </h3>
      <p style={{ fontSize: 11, color: 'var(--sc-text-low)', margin: '4px 0 14px' }}>
        SKU:{' '}
        <code
          className="sc-mono"
          style={{
            background: 'rgba(30,58,138,0.05)',
            padding: '1px 6px',
            borderRadius: 4,
            fontSize: 10,
            color: 'var(--sc-text-mid)',
          }}
        >
          {sku}
        </code>
      </p>

      <div className="flex flex-col gap-2.5">
        {status.map((s: any) => {
          const info = STATUS_TONE[s.syncStatus] || STATUS_TONE.unlinked
          const isBusy = busy === s.connectionId
          const providerName = String(s.provider || '').toUpperCase()
          return (
            <div
              key={s.connectionId}
              style={{
                background: '#ffffff',
                border: '1px solid var(--sc-line-soft)',
                borderRadius: 10,
                padding: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                minWidth: 0,
              }}
            >
              {/* Header: provider + status chip */}
              <div className="flex items-center justify-between gap-2 min-w-0">
                <div className="min-w-0 flex-1">
                  <div
                    className="sc-mono"
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--sc-text-hi)',
                      letterSpacing: '0.10em',
                    }}
                  >
                    {providerName}
                  </div>
                  <div
                    className="truncate"
                    style={{ fontSize: 11, color: 'var(--sc-text-low)', marginTop: 2 }}
                  >
                    {s.connectionName}
                  </div>
                </div>
                <Chip tone={info.tone} dot={s.syncStatus === 'connected'}>
                  {info.label}
                </Chip>
              </div>

              {/* Status detail */}
              {s.syncStatus === 'connected' && s.marketplaceProductId && (
                <div
                  className="sc-mono truncate"
                  title={s.marketplaceProductId}
                  style={{
                    fontSize: 10,
                    color: 'var(--sc-text-mid)',
                    background: 'rgba(16,185,129,0.06)',
                    border: '1px solid rgba(16,185,129,0.18)',
                    borderRadius: 6,
                    padding: '6px 8px',
                  }}
                >
                  {s.marketplaceProductId}
                </div>
              )}
              {s.syncStatus === 'sku_duplicate' && s.errorMessage && (
                <p
                  className="line-clamp-2"
                  style={{ fontSize: 11, color: 'var(--sc-err)' }}
                >
                  {s.errorMessage}
                </p>
              )}

              {/* Actions row */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => detect(s.connectionId)}
                  disabled={isBusy}
                  title="Buscar coincidencia exacta del SKU"
                  className="sc-btn-ghost"
                  style={{
                    padding: '6px 10px',
                    fontSize: 11,
                    color: 'var(--sc-blue-700)',
                    borderColor: 'rgba(59,130,246,0.25)',
                    flex: 1,
                    justifyContent: 'center',
                    minWidth: 0,
                  }}
                >
                  {isBusy ? <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" /> : null}
                  <span className="truncate">Detectar SKU</span>
                </button>
                <button
                  onClick={() =>
                    setPicker({
                      connectionId: s.connectionId,
                      providerLabel: s.connectionName || s.provider,
                    })
                  }
                  disabled={isBusy}
                  title="Buscar manualmente entre las publicaciones del marketplace"
                  className="sc-btn-ghost"
                  style={{
                    padding: '6px 10px',
                    fontSize: 11,
                    flex: 1,
                    justifyContent: 'center',
                    minWidth: 0,
                  }}
                >
                  <Search className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">Buscar</span>
                </button>
                {s.linked && (
                  <button
                    onClick={() => unlink(s.connectionId)}
                    disabled={isBusy}
                    title="Desvincular publicación"
                    className="sc-btn-ghost"
                    style={{
                      padding: 6,
                      color: 'var(--sc-err)',
                      borderColor: 'rgba(220,38,38,0.20)',
                    }}
                    aria-label="Desvincular"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {picker && (
        <MarketplaceProductPicker
          productId={productId}
          connectionId={picker.connectionId}
          providerLabel={picker.providerLabel}
          onClose={() => setPicker(null)}
          onLinked={() => queryClient.invalidateQueries({ queryKey: ['product-marketplaces', productId] })}
        />
      )}
    </div>
  )
}

// ─── Calculadora de precios por marketplace ───────────────────────────────────

const MARKETPLACE_DEFAULTS: Record<string, { label: string; commission: number; shipping: number; color: string }> = {
  lider:         { label: 'Lider',          commission: 12, shipping: 3500,  color: 'bg-blue-600' },
  mercadolibre:  { label: 'MercadoLibre',   commission: 13, shipping: 2990,  color: 'bg-yellow-400' },
  paris:         { label: 'Paris',          commission: 15, shipping: 3500,  color: 'bg-red-700' },
  falabella:     { label: 'Falabella',      commission: 15, shipping: 3500,  color: 'bg-green-700' },
  shopify:       { label: 'Shopify',        commission: 2,  shipping: 0,     color: 'bg-green-600' },
  woocommerce:   { label: 'WooCommerce',    commission: 0,  shipping: 0,     color: 'bg-purple-600' },
  jumpseller:    { label: 'Jumpseller',     commission: 2,  shipping: 0,     color: 'bg-orange-500' },
}

function calcPrice(cost: number, commission: number, shipping: number, margin: number): number {
  if (commission + margin >= 100) return 0
  return Math.ceil((cost + shipping) / (1 - (commission + margin) / 100) / 10) * 10
}

function MarketplacePricingBlock({ product }: { product: any }) {
  const queryClient = useQueryClient()
  const cost = Number(product.costPrice ?? 0)
  const basePrice = Number(product.basePrice ?? 0)

  const { data: savedPricing } = useQuery<any>({
    queryKey: ['marketplace-pricing', product.id],
    queryFn: () => api.get(`/products/${product.id}/marketplace-pricing`).then(r => r.data),
  })

  const { data: connections = [] } = useQuery<any[]>({
    queryKey: ['connections-marketplace'],
    queryFn: () => api.get('/connections').then(r =>
      r.data.filter((c: any) => c.status === 'connected')
    ),
  })

  const [pricing, setPricing] = useState<Record<string, { commission: number; shipping: number; margin: number; enabled: boolean }>>({})
  const [saving, setSaving] = useState(false)

  // Inicializar con datos guardados o defaults
  useEffect(() => {
    if (!savedPricing || !connections.length) return
    const saved = savedPricing.pricing || {}
    const init: typeof pricing = {}
    for (const conn of connections) {
      const def = MARKETPLACE_DEFAULTS[conn.provider] || { commission: 12, shipping: 3500 }
      const s = saved[conn.provider] || {}
      init[conn.provider] = {
        commission: s.commission ?? def.commission,
        shipping:   s.shipping   ?? def.shipping,
        margin:     s.margin     ?? 10,
        enabled:    s.enabled    ?? true,
      }
    }
    setPricing(init)
  }, [savedPricing, connections])

  const set = (provider: string, key: string, val: number | boolean) =>
    setPricing(p => ({ ...p, [provider]: { ...p[provider], [key]: val } }))

  const save = async () => {
    setSaving(true)
    try {
      // Calcular y guardar el precio calculado por marketplace (basado en costo)
      const payload: Record<string, any> = {}
      for (const conn of connections) {
        const p = pricing[conn.provider]
        if (!p || !p.enabled) continue
        const calculated = calcPrice(cost, p.commission, p.shipping, p.margin)
        payload[conn.provider] = { ...p, calculatedPrice: calculated }
      }
      await api.patch(`/products/${product.id}/marketplace-pricing`, payload)
      queryClient.invalidateQueries({ queryKey: ['marketplace-pricing', product.id] })
      toast.success('Precios por marketplace guardados')
    } catch {
      toast.error('Error al guardar precios')
    } finally {
      setSaving(false)
    }
  }

  if (!connections.length) return null

  // Sin costo no se puede calcular nada útil
  if (!cost) {
    return (
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
          Calculadora de precios por marketplace
        </p>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
          <p className="font-medium">Falta el precio de costo</p>
          <p className="text-xs mt-1 text-amber-700">
            Para calcular precios por marketplace, primero ingresa el costo del producto en la sección de precios.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
        Calculadora de precios por marketplace
      </p>
      <p className="text-xs text-gray-400 mb-3">
        Costo base: <span className="font-semibold text-gray-700">{formatCurrency(cost)}</span>
        {basePrice > 0 && <span className="ml-3">· Precio venta directa: <span className="font-semibold text-gray-700">{formatCurrency(basePrice)}</span></span>}
      </p>
      <div className="space-y-3">
        {connections.map((conn: any) => {
          const def = MARKETPLACE_DEFAULTS[conn.provider]
          const p = pricing[conn.provider]
          if (!p) return null
          const calculated = calcPrice(cost, p.commission, p.shipping, p.margin)
          const gain = calculated - cost - p.shipping
          const gainPct = cost > 0 ? ((gain / cost) * 100).toFixed(1) : '0'

          return (
            <div key={conn.provider} className={`border rounded-xl overflow-hidden ${p.enabled ? 'border-gray-200' : 'border-gray-100 opacity-50'}`}>
              <div className="flex items-center justify-between px-3 py-2 bg-gray-50">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${def?.color || 'bg-gray-400'}`} />
                  <span className="text-sm font-medium text-gray-800">{def?.label || conn.provider}</span>
                </div>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={p.enabled} onChange={e => set(conn.provider, 'enabled', e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-sky-600 focus:ring-sky-500" />
                  <span className="text-xs text-gray-500">Activo</span>
                </label>
              </div>

              {p.enabled && (
                <div className="px-3 py-3 space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Comisión %</label>
                      <input type="number" min="0" max="50" step="0.5"
                        value={p.commission}
                        onChange={e => set(conn.provider, 'commission', Number(e.target.value))}
                        className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-sky-500 text-center" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Despacho $</label>
                      <input type="number" min="0" step="100"
                        value={p.shipping}
                        onChange={e => set(conn.provider, 'shipping', Number(e.target.value))}
                        className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-sky-500 text-center" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Margen %</label>
                      <input type="number" min="0" max="80" step="1"
                        value={p.margin}
                        onChange={e => set(conn.provider, 'margin', Number(e.target.value))}
                        className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-sky-500 text-center" />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-gray-100">
                    <div>
                      <p className="text-xs text-gray-400">Precio sugerido</p>
                      <p className="text-base font-bold text-sky-700">{formatCurrency(calculated)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-400">Ganancia estimada</p>
                      <p className={`text-sm font-semibold ${gain > 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {formatCurrency(gain)} ({gainPct}%)
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <button
        onClick={save}
        disabled={saving}
        className="mt-3 w-full px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
        Guardar precios
      </button>
    </div>
  )
}

function ParisConfigBlock({ product }: { product: any }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const initial = product.parisData || {}
  const [familyId, setFamilyId] = useState<string>(initial.familyId || '')
  const [categoryId, setCategoryId] = useState<string>(initial.categoryId || '')
  const [priceTypeId, setPriceTypeId] = useState<string>(initial.priceTypeId || '')
  const [sellerSku, setSellerSku] = useState<string>(initial.sellerSku || '')
  const [productAttrs, setProductAttrs] = useState<Record<string, string>>(
    Object.fromEntries((initial.productAttributes || []).map((a: any) => [a.id, a.value])),
  )
  const [variantAttrs, setVariantAttrs] = useState<Record<string, string>>(
    Object.fromEntries(
      ((initial.variants?.[0]?.attributes) || []).map((a: any) => [a.id, a.value]),
    ),
  )
  const [hasVariants, setHasVariants] = useState<boolean>(initial.hasVariants ?? false)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)

  const { data: families } = useQuery<any>({
    enabled: open,
    queryKey: ['paris-families'],
    queryFn: () => api.get('/products/paris/families').then((r) => r.data),
    staleTime: 60 * 60 * 1000,
  })

  const { data: categories } = useQuery<any>({
    enabled: open && !!familyId,
    queryKey: ['paris-categories', familyId],
    queryFn: () =>
      api.get(`/products/paris/families/${familyId}/categories`).then((r) => r.data),
    staleTime: 60 * 60 * 1000,
  })

  const { data: attributes } = useQuery<any>({
    enabled: open && !!familyId,
    queryKey: ['paris-attrs', familyId, 'product'],
    queryFn: () =>
      api
        .get(`/products/paris/families/${familyId}/attributes`, { params: { kind: 'product' } })
        .then((r) => r.data),
    staleTime: 60 * 60 * 1000,
  })

  const { data: vAttributes } = useQuery<any>({
    enabled: open && !!familyId,
    queryKey: ['paris-attrs', familyId, 'variant'],
    queryFn: () =>
      api
        .get(`/products/paris/families/${familyId}/attributes`, { params: { kind: 'variant' } })
        .then((r) => r.data),
    staleTime: 60 * 60 * 1000,
  })

  const { data: priceTypes } = useQuery<any>({
    enabled: open,
    queryKey: ['paris-price-types'],
    queryFn: () => api.get('/products/paris/price-types').then((r) => r.data),
    staleTime: 60 * 60 * 1000,
  })

  const allAttrs: any[] = attributes?.results || []
  const requiredAttrs: any[] = allAttrs.filter(
    (a: any) => a.familyAttributes?.[0]?.attributeValidation?.isRequired,
  )
  // Highlight description/feature fields even if optional — sellers always want them.
  const FEATURED_REGEX = /^(descripci[oó]n corta|descripci[oó]n larga\/?(emocional)?|caracter[ií]sticas)$/i
  const featuredAttrs: any[] = allAttrs.filter(
    (a: any) =>
      !a.familyAttributes?.[0]?.attributeValidation?.isRequired &&
      FEATURED_REGEX.test(a.name || ''),
  )

  // Auto-populate "Descripción corta" / "Descripción Larga" from master if empty.
  useEffect(() => {
    if (!attributes?.results) return
    const next: Record<string, string> = { ...productAttrs }
    let changed = false
    for (const a of featuredAttrs) {
      if (next[a.id]) continue
      if (/descripci/i.test(a.name) && product.description) {
        next[a.id] = product.description
        changed = true
      }
    }
    if (changed) setProductAttrs(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId, attributes?.results])

  const variantAttrsList: any[] = vAttributes?.results || []
  const requiredVariantAttrs: any[] = variantAttrsList.filter(
    (a: any) => a.familyAttributes?.[0]?.attributeValidation?.isRequired,
  )

  // Default neutral values when the product has no real variants. The IDs are
  // the same the user would pick manually for "Talla Única" and "Color Negro".
  const DEFAULT_VARIANT_VALUES: Record<string, string> = {
    '07fa21d9-3b74-48d8-b811-1faa3117fba4': '529f9f29-796c-43a3-97ba-b6ae6f7446e2', // Talla → Talla Única
    '705bb298-6558-425c-9a4c-3e1b65c73060': 'd578892b-b766-43e8-88bf-f9a289b016a2', // Color → Negro
  }

  const effectiveVariantAttrs: Record<string, string> = hasVariants
    ? variantAttrs
    : Object.fromEntries(
        requiredVariantAttrs.map((a) => [a.id, DEFAULT_VARIANT_VALUES[a.id] || '']),
      )

  const allRequiredFilled =
    requiredAttrs.every((a) => (productAttrs[a.id] || '').trim() !== '') &&
    requiredVariantAttrs.every((a) => (effectiveVariantAttrs[a.id] || '').trim() !== '')
  const canPublish = !!familyId && !!categoryId && !!priceTypeId && allRequiredFilled

  const buildPayload = () => ({
    sellerSku: sellerSku || product.sku,
    familyId,
    categoryId,
    priceTypeId,
    hasVariants,
    productAttributes: [...requiredAttrs, ...featuredAttrs]
      .map((a) => ({ id: a.id, value: productAttrs[a.id] }))
      .filter((a) => a.value && String(a.value).trim() !== ''),
    variants: [
      {
        sellerSku: sellerSku || product.sku,
        attributes: requiredVariantAttrs
          .map((a) => ({ id: a.id, value: effectiveVariantAttrs[a.id] }))
          .filter((a) => a.value && String(a.value).trim() !== ''),
      },
    ],
  })

  const save = async () => {
    setSaving(true)
    try {
      await api.patch(`/products/${product.id}/paris-data`, buildPayload())
      toast.success('Configuración Paris guardada')
      queryClient.invalidateQueries({ queryKey: ['products'] })
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const publish = async () => {
    setPublishing(true)
    try {
      await api.patch(`/products/${product.id}/paris-data`, buildPayload())
      const res = await api.post(`/products/${product.id}/paris/publish`)
      if (res.data?.success) {
        toast.success(`Publicado en Paris (ID: ${res.data.externalId})`)
        queryClient.invalidateQueries({ queryKey: ['product-marketplaces', product.id] })
      } else {
        toast.error(`Error: ${typeof res.data?.error === 'string' ? res.data.error : JSON.stringify(res.data?.error)}`)
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Error al publicar')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="border border-red-100 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between p-3 bg-red-50 hover:bg-red-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded bg-red-700 text-white text-xs font-bold">PARIS</span>
          <span className="text-sm font-medium text-gray-900">Configuración para publicar en Paris</span>
        </div>
        <span className="text-xs text-gray-500">{open ? '▼' : '▶'}</span>
      </button>

      {open && (
        <div className="p-4 space-y-4 bg-white">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">SKU para Paris (opcional)</label>
            <input
              value={sellerSku}
              onChange={(e) => setSellerSku(e.target.value)}
              placeholder={product.sku}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <p className="text-xs text-gray-400 mt-1">
              Si lo dejas vacío usaremos el SKU del maestro: <code>{product.sku}</code>
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <LocalCombobox
              label="Familia"
              required
              options={(families?.results || []).map((f: any) => ({ id: f.id, name: f.name }))}
              value={familyId}
              onChange={(v) => {
                setFamilyId(v)
                setCategoryId('')
                setProductAttrs({})
              }}
            />

            <LocalCombobox
              label="Categoría"
              required
              disabled={!familyId}
              options={(categories?.results || []).map((c: any) => ({
                id: c.id,
                name: c.name,
                hint: c.path,
              }))}
              value={categoryId}
              onChange={setCategoryId}
              footer={
                categoryId
                  ? (categories?.results || []).find((c: any) => c.id === categoryId)?.path
                  : undefined
              }
            />
          </div>

          <div>
            <LocalCombobox
              label="Tipo de precio"
              required
              options={(priceTypes?.results || []).map((p: any) => ({ id: p.id, name: p.name }))}
              value={priceTypeId}
              onChange={setPriceTypeId}
            />
            <p className="text-xs text-gray-400 mt-1">
              Se usará el precio base del maestro: {formatCurrency(Number(product.basePrice), 'CLP')}
            </p>
          </div>

          {familyId && requiredAttrs.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
                Atributos requeridos ({requiredAttrs.length})
              </p>
              <div className="space-y-2">
                {requiredAttrs.map((attr: any) => (
                  <ParisAttributeInput
                    key={attr.id}
                    attribute={attr}
                    value={productAttrs[attr.id] || ''}
                    onChange={(v) => setProductAttrs({ ...productAttrs, [attr.id]: v })}
                  />
                ))}
              </div>
            </div>
          )}

          {familyId && requiredVariantAttrs.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
                Variantes
              </p>
              <p className="text-xs text-gray-600 mb-2">
                ¿Tu producto tiene variantes (talla, color, etc.)?
              </p>
              <div className="flex gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setHasVariants(false)}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                    !hasVariants
                      ? 'bg-red-700 text-white border-red-700'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  No, es un producto único
                </button>
                <button
                  type="button"
                  onClick={() => setHasVariants(true)}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                    hasVariants
                      ? 'bg-red-700 text-white border-red-700'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Sí, tiene variantes
                </button>
              </div>
              {!hasVariants && (
                <p className="text-xs text-gray-500 bg-gray-50 rounded p-2">
                  Se asignarán automáticamente <strong>Talla Única</strong> y <strong>Color Negro</strong>{' '}
                  como valores neutros. Paris exige estos atributos aunque el producto no tenga variantes.
                </p>
              )}
              {hasVariants && (
                <div className="space-y-2">
                  {requiredVariantAttrs.map((attr: any) => (
                    <ParisAttributeInput
                      key={attr.id}
                      attribute={attr}
                      value={variantAttrs[attr.id] || ''}
                      onChange={(v) => setVariantAttrs({ ...variantAttrs, [attr.id]: v })}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {familyId && featuredAttrs.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
                Descripción y ficha técnica
                <span className="text-gray-400 font-normal ml-1">(opcional, recomendado)</span>
              </p>
              <div className="space-y-2">
                {featuredAttrs.map((attr: any) => (
                  <ParisAttributeInput
                    key={attr.id}
                    attribute={attr}
                    value={productAttrs[attr.id] || ''}
                    onChange={(v) => setProductAttrs({ ...productAttrs, [attr.id]: v })}
                  />
                ))}
              </div>
            </div>
          )}

          {familyId && requiredAttrs.length === 0 && attributes && (
            <p className="text-xs text-gray-500">Esta familia no tiene atributos requeridos.</p>
          )}

          <div className="flex gap-2 pt-2">
            <button
              onClick={save}
              disabled={!familyId || !categoryId || saving || publishing}
              className="px-4 py-2 border border-red-200 text-red-700 hover:bg-red-50 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Guardar configuración
            </button>
            <button
              onClick={publish}
              disabled={!canPublish || saving || publishing}
              className="flex-1 px-4 py-2 bg-red-700 hover:bg-red-800 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {publishing && <Loader2 className="w-4 h-4 animate-spin" />}
              Publicar en Paris
            </button>
          </div>

          {!canPublish && (
            <p className="text-xs text-gray-400">
              Completa familia, categoría, tipo de precio y los atributos requeridos para publicar.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ParisAttributeInput({
  attribute,
  value,
  onChange,
}: {
  attribute: any
  value: string
  onChange: (v: string) => void
}) {
  // Heuristic for "has options": Paris returns attributeOptions but for lists with
  // thousands of items (like Marca with 28k+) it can be empty in the family payload.
  // Trust the validation type instead — the API has its own type field.
  const validation = attribute.familyAttributes?.[0]?.attributeValidation
  const length = validation?.length
  const hasInlineOptions = (attribute.attributeOptions || []).length > 0
  // Treat as a searchable list for known dropdown attributes (Marca, Condición, etc.)
  // — Paris returns isList via attribute.type but here we use a probe: try fetch with q=''.
  const isListLikely = hasInlineOptions || /marca|condici/i.test(attribute.name || '')

  if (isListLikely) {
    return (
      <ParisOptionPicker
        attributeId={attribute.id}
        label={attribute.name}
        inlineOptions={attribute.attributeOptions}
        value={value}
        onChange={onChange}
      />
    )
  }

  const required = !!validation?.isRequired
  const isLong = (length || 0) >= 1000

  return (
    <div>
      <label className="block text-xs text-gray-700 mb-1">
        {attribute.name} {required && <span className="text-red-500">*</span>}
        {length ? <span className="text-gray-400 font-normal"> (max {length})</span> : null}
      </label>
      {isLong ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, length || 5000))}
          rows={4}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 resize-y"
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value.slice(0, length || 5000))}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
        />
      )}
      {value && length ? (
        <p className="text-[10px] text-gray-400 mt-0.5 text-right">
          {value.length}/{length}
        </p>
      ) : null}
    </div>
  )
}

function LocalCombobox({
  label,
  options,
  value,
  onChange,
  required,
  disabled,
  footer,
}: {
  label: string
  options: Array<{ id: string; name: string; hint?: string }>
  value: string
  onChange: (v: string) => void
  required?: boolean
  disabled?: boolean
  footer?: string
}) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)

  const selected = options.find((o) => o.id === value)
  const filtered = search.trim()
    ? options.filter((o) =>
        (o.name + ' ' + (o.hint || '')).toLowerCase().includes(search.toLowerCase()),
      )
    : options

  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <div className="relative">
        <input
          value={open ? search : selected?.name || ''}
          onChange={(e) => {
            setSearch(e.target.value)
            if (!open) setOpen(true)
          }}
          onFocus={() => !disabled && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          disabled={disabled}
          placeholder={disabled ? '' : 'Escribe para filtrar…'}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm disabled:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-red-500"
        />
        {open && !disabled && (
          <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-400">Sin resultados</div>
            ) : (
              filtered.slice(0, 100).map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    onChange(o.id)
                    setSearch('')
                    setOpen(false)
                  }}
                  title={o.hint}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-red-50 transition-colors ${
                    value === o.id ? 'bg-red-50 font-medium' : ''
                  }`}
                >
                  {o.name}
                  {o.hint && (
                    <span className="block text-[10px] text-gray-400 truncate">{o.hint}</span>
                  )}
                </button>
              ))
            )}
          </div>
        )}
      </div>
      {footer && (
        <p className="text-xs text-gray-500 mt-1 truncate" title={footer}>
          {footer}
        </p>
      )}
    </div>
  )
}

function ParisOptionPicker({
  attributeId,
  label,
  inlineOptions,
  value,
  onChange,
}: {
  attributeId: string
  label: string
  inlineOptions?: any[]
  value: string
  onChange: (v: string) => void
}) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [debounced, setDebounced] = useState('')
  // Cache the picked option's display name. The remote list changes when the
  // user types; without this we'd show the raw ID after a refresh.
  const [selectedName, setSelectedName] = useState<string>('')

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const { data, isFetching } = useQuery<any>({
    enabled: open,
    queryKey: ['paris-attr-options', attributeId, debounced],
    queryFn: () =>
      api
        .get(`/products/paris/attributes/${attributeId}/options`, {
          params: debounced ? { q: debounced } : {},
        })
        .then((r) => r.data),
    staleTime: 60 * 1000,
  })

  const options: any[] = data?.results || inlineOptions || []

  // If we got a value but no cached name yet, try to backfill from inline options.
  useEffect(() => {
    if (value && !selectedName) {
      const inline = (inlineOptions || []).find((o: any) => o.id === value)
      if (inline) setSelectedName(inline.name || inline.value || '')
    }
    if (!value) setSelectedName('')
  }, [value, inlineOptions, selectedName])

  return (
    <div>
      <label className="block text-xs text-gray-700 mb-1">
        {label} <span className="text-red-500">*</span>
      </label>
      <div className="relative">
        <input
          value={open ? search : selectedName}
          onChange={(e) => {
            setSearch(e.target.value)
            if (!open) setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          placeholder="Escribe para buscar…"
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
        />
        {open && (
          <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
            {isFetching && options.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-400">Buscando…</div>
            ) : options.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-400">Sin resultados</div>
            ) : (
              options.slice(0, 50).map((o: any) => (
                <button
                  key={o.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    onChange(o.id)
                    setSelectedName(o.name || o.value || '')
                    setSearch('')
                    setOpen(false)
                  }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-red-50 transition-colors ${
                    value === o.id ? 'bg-red-50 font-medium' : ''
                  }`}
                >
                  {o.name || o.value}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
