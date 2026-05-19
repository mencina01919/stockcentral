'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Loader2, Package, Edit, Trash2, RefreshCw, X, Image as ImageIcon, ExternalLink, Database, Check, Upload, Download } from 'lucide-react'
import Link from 'next/link'
import api from '@/lib/api'
import { Header } from '@/components/layout/header'
import { ProviderLogo } from '@/components/provider-logo'
import { Panel, MonoLabel, Chip } from '@/components/sc/ui'
import { ImageUploader } from '@/components/sc/image-uploader'
import { ImageGrid } from '@/components/sc/image-grid'
import { formatCurrency, PRODUCT_STATUS_LABELS, PROVIDER_LABELS } from '@/lib/utils'
import { toast } from 'sonner'

type ProductStatus = 'all' | 'active' | 'out_of_stock' | 'coming_soon' | 'unavailable'

export default function ProductsPage() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<ProductStatus>('all')
  const [page, setPage] = useState(1)
  const [showForm, setShowForm] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const handleDownloadExcel = async () => {
    try {
      setDownloading(true)
      const res = await api.get('/products/export.xlsx', { responseType: 'blob' })
      const cd = res.headers['content-disposition'] || ''
      const match = cd.match(/filename="?([^"]+)"?/)
      const filename = match?.[1] || `catalogo-activos-${new Date().toISOString().slice(0, 10)}.xlsx`
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo descargar el Excel')
    } finally {
      setDownloading(false)
    }
  }

  const { data, isLoading } = useQuery({
    queryKey: ['products', search, status, page],
    queryFn: () =>
      api.get('/products', {
        params: { search, status: status === 'all' ? undefined : status, page, limit: 20 },
      }).then((r) => r.data),
    placeholderData: (prev) => prev,
  })

  // Marketplace channels for the columns (connected only, EYLSTORE excluded
  // because it's the catalog source, not a sales channel).
  const { data: channels = [] } = useQuery<any[]>({
    queryKey: ['products-master-channels'],
    queryFn: () =>
      api.get('/connections').then((r) =>
        r.data.filter(
          (c: any) =>
            c.type === 'marketplace' &&
            c.status === 'connected' &&
            c.provider !== 'eylstore',
        ),
      ),
    staleTime: 60_000,
  })

  const archiveMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/products/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      toast.success('Producto eliminado')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'No se pudo eliminar el producto')
    },
  })

  // Delete flow that handles the linked-marketplaces case: if the API rejects
  // because the product still has active marketplace mappings, ask the user to
  // unlink them all and retry the delete in a single action.
  const handleDelete = async (product: any) => {
    if (!confirm(`¿Eliminar "${product.name}"? Esta acción no se puede deshacer.`)) return
    try {
      await api.delete(`/products/${product.id}`)
      toast.success('Producto eliminado')
      queryClient.invalidateQueries({ queryKey: ['products'] })
    } catch (err: any) {
      const data = err?.response?.data
      if (data?.code === 'PRODUCT_HAS_LINKED_MARKETPLACES' && Array.isArray(data?.linkedMarketplaces)) {
        const list = data.linkedMarketplaces.map((m: any) => `• ${m.provider} (${m.marketplaceProductId})`).join('\n')
        const ok = confirm(
          `Este producto está vinculado a:\n${list}\n\n¿Desvincular de todos y eliminar el producto?\n\nNota: el listado seguirá publicado en cada marketplace.`,
        )
        if (!ok) return
        try {
          // Unlink all marketplaces in parallel, then retry delete.
          await Promise.all(
            data.linkedMarketplaces.map((m: any) =>
              api.delete(`/products/${product.id}/marketplaces/${m.connectionId}`),
            ),
          )
          await api.delete(`/products/${product.id}`)
          toast.success('Producto desvinculado y eliminado')
          queryClient.invalidateQueries({ queryKey: ['products'] })
        } catch (err2: any) {
          toast.error(err2?.response?.data?.message || 'No se pudo eliminar tras desvincular')
        }
        return
      }
      toast.error(data?.message || 'No se pudo eliminar el producto')
    }
  }

  const products = data?.data || []
  const meta = data?.meta

  const statusTabs = [
    { key: 'all', label: 'Todos' },
    { key: 'active', label: 'Activos' },
    { key: 'out_of_stock', label: 'Agotados' },
    { key: 'coming_soon', label: 'Próximamente' },
    { key: 'unavailable', label: 'No disponibles' },
  ]

  return (
    <div className="flex flex-col h-full">
      <Header
        breadcrumbs={['CONSOLA', 'PRODUCTOS', 'MAESTRO']}
        title="Catálogo maestro"
        subtitle="Gestiona tu catálogo de productos"
      />

      <div className="flex-1 p-6 overflow-auto">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                placeholder="Buscar por nombre o SKU..."
                className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/products/master/source"
                className="flex items-center gap-2 border border-gray-200 hover:bg-gray-50 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                title="Configurar fuente del catálogo"
              >
                <Database className="w-4 h-4" />
                Fuente
              </Link>
              <button
                onClick={handleDownloadExcel}
                disabled={downloading}
                className="flex items-center gap-2 border border-gray-200 hover:bg-gray-50 text-gray-700 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Descargar Excel con catálogo de productos activos"
              >
                {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Descargar Excel
              </button>
              <button
                onClick={() => setShowForm(true)}
                className="flex items-center gap-2 bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              >
                <Plus className="w-4 h-4" />
                Nuevo producto
              </button>
            </div>
          </div>

          <div className="px-4 border-b border-gray-100 flex gap-1">
            {statusTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => { setStatus(tab.key as ProductStatus); setPage(1) }}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  status === tab.key
                    ? 'border-sky-600 text-sky-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-16">
              <Package className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">No hay productos</p>
              <p className="text-gray-400 text-sm mt-1">Crea tu primer producto para comenzar</p>
            </div>
          ) : (
            <div className="overflow-auto max-h-[calc(100vh-280px)]">
              <table className="w-full">
                <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm">
                  <tr>
                    {['SKU', 'Producto', 'Precio', 'Stock'].map((h) => (
                      <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                    {channels.map((ch: any) => (
                      <th
                        key={ch.id}
                        className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
                        title={`${PROVIDER_LABELS[ch.provider] || ch.provider} — ${ch.name}`}
                      >
                        <div className="flex flex-col items-center gap-1">
                          <ProviderLogo provider={ch.provider} size="sm" variant="plain" />
                          <span className="text-[10px] normal-case font-normal text-gray-400 max-w-[80px] truncate">
                            {PROVIDER_LABELS[ch.provider] || ch.provider}
                          </span>
                        </div>
                      </th>
                    ))}
                    {['Estado', 'Acciones'].map((h) => (
                      <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {products.map((product: any) => {
                    const totalStock = product.inventory?.reduce((sum: number, inv: any) => {
                      const wt = inv.warehouse?.warehouseType
                      return wt === 'online' || wt === 'store' ? sum + inv.quantity : sum
                    }, 0) || 0
                    const images = product.images as string[] | null
                    return (
                      <tr key={product.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 text-sm font-mono text-gray-500">{product.sku}</td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            {images && images.length > 0 ? (
                              <img src={images[0]} alt={product.name} className="w-10 h-10 object-cover rounded-lg border border-gray-100 flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                            ) : (
                              <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                                <Package className="w-4 h-4 text-gray-300" />
                              </div>
                            )}
                            <div>
                              <p className="text-sm font-medium text-gray-900 max-w-xs truncate">{product.name}</p>
                              {product.description && (
                                <p className="text-xs text-gray-400 truncate max-w-xs">{product.description}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <p className="text-sm font-medium text-gray-800">{formatCurrency(Number(product.basePrice))}</p>
                          {product.costPrice && (
                            <p className="text-xs text-gray-400">Costo: {formatCurrency(Number(product.costPrice))}</p>
                          )}
                          {product.targetMargin != null && (
                            <p className="text-xs text-sky-600">Margen: {Number(product.targetMargin).toFixed(1)}%</p>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`text-sm font-medium ${totalStock === 0 ? 'text-red-500' : totalStock < 5 ? 'text-amber-500' : 'text-gray-700'}`}>
                            {totalStock} uds
                          </span>
                        </td>
                        {channels.map((ch: any) => {
                          const mapping = product.marketplaceMappings?.find(
                            (m: any) => m.connectionId === ch.id,
                          )
                          const isPublished = !!mapping?.marketplaceProductId
                          const hasError = mapping?.syncStatus === 'error'
                          return (
                            <td key={ch.id} className="px-3 py-4 text-center">
                              <button
                                onClick={() =>
                                  router.push(
                                    `/publications?productId=${product.id}&connectionId=${ch.id}`,
                                  )
                                }
                                title={
                                  isPublished
                                    ? `Publicado en ${PROVIDER_LABELS[ch.provider] || ch.provider} — click para gestionar`
                                    : `No publicado en ${PROVIDER_LABELS[ch.provider] || ch.provider} — click para publicar`
                                }
                                className="inline-flex items-center justify-center w-7 h-7 rounded-full transition-colors hover:bg-gray-100"
                              >
                                {isPublished ? (
                                  <span
                                    className={`w-5 h-5 rounded-full flex items-center justify-center ${
                                      hasError ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'
                                    }`}
                                  >
                                    <Check className="w-3 h-3" strokeWidth={3} />
                                  </span>
                                ) : (
                                  <span className="w-5 h-5 rounded-full border-2 border-dashed border-gray-200" />
                                )}
                              </button>
                            </td>
                          )
                        })}
                        <td className="px-6 py-4">
                          {(() => {
                            const s = PRODUCT_STATUS_LABELS[product.status] || { label: product.status, color: 'bg-gray-100 text-gray-500' }
                            return <span className={`px-2 py-1 rounded-full text-xs font-medium ${s.color}`}>{s.label}</span>
                          })()}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => router.push(`/products/master/${product.id}`)}
                              title="Editar producto"
                              className="p-1.5 text-gray-400 hover:text-sky-600 hover:bg-sky-50 rounded transition-colors"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(product)}
                              title="Eliminar"
                              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {meta && meta.totalPages > 1 && (
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
              <p className="text-sm text-gray-500">
                {meta.total} productos — Página {meta.page} de {meta.totalPages}
              </p>
              <div className="flex gap-2">
                <button onClick={() => setPage((p) => p - 1)} disabled={!meta.hasPrevPage} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition-colors">Anterior</button>
                <button onClick={() => setPage((p) => p + 1)} disabled={!meta.hasNextPage} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition-colors">Siguiente</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {showForm && (
        <ProductFormModal onClose={() => setShowForm(false)} onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['products'] })
          setShowForm(false)
        }} />
      )}
    </div>
  )
}


function ProductFormModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({
    sku: '', barcode: '', name: '', brand: '', basePrice: '', costPrice: '', transferPrice: '',
    salePrice: '', description: '', status: 'active',
    stockOnline: '0', stockWarehouse: '0', stockStore: '0',
    images: '',
  })
  const [loading, setLoading] = useState(false)
  const imageList = form.images.split('\n').map((s) => s.trim()).filter(Boolean)

  const autoMargin = form.costPrice && form.basePrice
    ? ((1 - Number(form.costPrice) / Number(form.basePrice)) * 100).toFixed(1)
    : null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await api.post('/products', {
        sku: form.sku || undefined,
        barcode: form.barcode.trim() || undefined,
        name: form.name,
        brand: form.brand || undefined,
        description: form.description || undefined,
        basePrice: Number(form.basePrice),
        costPrice: form.costPrice ? Number(form.costPrice) : undefined,
        transferPrice: form.transferPrice ? Number(form.transferPrice) : undefined,
        salePrice: form.salePrice ? Number(form.salePrice) : undefined,
        status: form.status,
        stockOnline: Number(form.stockOnline),
        stockWarehouse: Number(form.stockWarehouse),
        stockStore: Number(form.stockStore),
        images: imageList.length ? imageList : undefined,
      })
      toast.success('Producto creado correctamente')
      onSuccess()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Error al crear el producto')
    } finally {
      setLoading(false)
    }
  }

  const f = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(prev => ({ ...prev, [key]: e.target.value })),
  })

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Nuevo producto</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto">
          {/* Identificación */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre *</label>
              <input {...f('name')} required placeholder="Ej: Zapatilla Nike Air Max 270"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Marca</label>
              <input {...f('brand')} placeholder="Ej: Nike"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                SKU <span className="text-gray-400 font-normal text-xs">(auto si se deja vacío)</span>
              </label>
              <input {...f('sku')} placeholder="Ej: NIK-AM270-BLK"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Código de barras <span className="text-gray-400 font-normal text-xs">(UPC / EAN / GTIN, opcional)</span>
              </label>
              <input {...f('barcode')} placeholder="Ej: 7804609001234"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-500" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
              <select {...f('status')} className="w-full max-w-xs px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
                <option value="active">Activo</option>
                <option value="out_of_stock">Agotado</option>
                <option value="coming_soon">Próximamente</option>
                <option value="unavailable">No disponible</option>
              </select>
            </div>
          </div>

          {/* Precios */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Precios</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Precio costo (CLP)</label>
                <input type="number" {...f('costPrice')} min="0" placeholder="Ej: 25000"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Precio transferencia (CLP)</label>
                <input type="number" {...f('transferPrice')} min="0" placeholder="Ej: 30000"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Precio base (CLP) *</label>
                <input type="number" {...f('basePrice')} required min="0" placeholder="Ej: 59990"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                {autoMargin && (
                  <p className="text-xs text-sky-600 mt-1">Margen estimado: {autoMargin}%</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Precio oferta (CLP)</label>
                <input type="number" {...f('salePrice')} min="0" placeholder="Opcional"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
              </div>
            </div>
          </div>

          {/* Stock inicial */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Stock inicial</p>
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: 'Online', key: 'stockOnline' as const },
                { label: 'Bodega', key: 'stockWarehouse' as const },
                { label: 'Tienda', key: 'stockStore' as const },
              ].map(({ label, key }) => (
                <div key={key}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                  <input type="number" {...f(key)} min="0"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
            <textarea {...f('description')} rows={3} placeholder="Descripción del producto"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none" />
          </div>

          {/* Imágenes */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Imágenes</p>
              <ImageUploader
                disabled={loading}
                onUploaded={(url) => {
                  setForm((prev) => ({
                    ...prev,
                    images: prev.images.trim() ? `${prev.images.trim()}\n${url}` : url,
                  }))
                }}
              />
            </div>

            {imageList.length > 0 && (
              <div className="mb-2">
                <ImageGrid
                  urls={imageList}
                  cellSize={80}
                  disabled={loading}
                  onChange={(next) => setForm((prev) => ({ ...prev, images: next.join('\n') }))}
                />
                <p
                  className="sc-mono"
                  style={{
                    fontSize: 10,
                    color: 'var(--sc-text-faint)',
                    letterSpacing: '0.16em',
                    marginTop: 6,
                  }}
                >
                  ⇄ ARRASTRA PARA REORDENAR
                </p>
              </div>
            )}

            <textarea
              {...f('images')}
              rows={3}
              placeholder="O pega URLs externas (una por línea)"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none"
            />
            <p className="text-xs text-gray-400 mt-1">
              Sube imágenes desde tu equipo o pega URLs. La primera será la imagen principal.
            </p>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition-colors">Cancelar</button>
            <button type="submit" disabled={loading} className="flex-1 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Crear producto
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
