'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Loader2, Package, Edit, Trash2, RefreshCw, X, Image as ImageIcon, ExternalLink } from 'lucide-react'
import api from '@/lib/api'
import { Header } from '@/components/layout/header'
import { formatCurrency } from '@/lib/utils'
import { toast } from 'sonner'

type ProductStatus = 'all' | 'active' | 'draft' | 'archived'

export default function ProductsPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<ProductStatus>('all')
  const [page, setPage] = useState(1)
  const [showForm, setShowForm] = useState(false)
  const [editingProduct, setEditingProduct] = useState<any>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['products', search, status, page],
    queryFn: () =>
      api.get('/products', {
        params: { search, status: status === 'all' ? undefined : status, page, limit: 20 },
      }).then((r) => r.data),
    placeholderData: (prev) => prev,
  })

  const archiveMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/products/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      toast.success('Producto archivado')
    },
  })

  const products = data?.data || []
  const meta = data?.meta

  const statusTabs = [
    { key: 'all', label: 'Todos' },
    { key: 'active', label: 'Activos' },
    { key: 'draft', label: 'Borradores' },
    { key: 'archived', label: 'Archivados' },
  ]

  return (
    <div className="flex flex-col h-full">
      <Header title="Productos" subtitle="Gestiona tu catálogo de productos" />

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
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 bg-sky-600 hover:bg-sky-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              Nuevo producto
            </button>
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
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    {['SKU', 'Producto', 'Precio', 'Stock', 'Canales', 'Estado', 'Acciones'].map((h) => (
                      <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {products.map((product: any) => {
                    const totalStock = product.inventory?.reduce((sum: number, inv: any) => sum + inv.quantity, 0) || 0
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
                        <td className="px-6 py-4 text-sm font-medium text-gray-800 whitespace-nowrap">
                          {formatCurrency(Number(product.basePrice))}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`text-sm font-medium ${totalStock === 0 ? 'text-red-500' : totalStock < 5 ? 'text-amber-500' : 'text-gray-700'}`}>
                            {totalStock} uds
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${product._count?.marketplaceMappings > 0 ? 'bg-sky-100 text-sky-700' : 'bg-gray-100 text-gray-500'}`}>
                            {product._count?.marketplaceMappings || 0} canales
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            product.status === 'active' ? 'bg-green-100 text-green-700' :
                            product.status === 'draft' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-gray-100 text-gray-500'
                          }`}>
                            {product.status === 'active' ? 'Activo' : product.status === 'draft' ? 'Borrador' : 'Archivado'}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setEditingProduct(product)}
                              title="Editar producto"
                              className="p-1.5 text-gray-400 hover:text-sky-600 hover:bg-sky-50 rounded transition-colors"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => archiveMutation.mutate(product.id)}
                              title="Archivar"
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

      {editingProduct && (
        <ProductEditModal
          product={editingProduct}
          onClose={() => setEditingProduct(null)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['products'] })
            setEditingProduct(null)
          }}
        />
      )}
    </div>
  )
}

function ProductEditModal({ product, onClose, onSuccess }: { product: any; onClose: () => void; onSuccess: () => void }) {
  const totalStock = product.inventory?.reduce((sum: number, inv: any) => sum + inv.quantity, 0) || 0
  const [form, setForm] = useState({
    name: product.name || '',
    description: product.description || '',
    basePrice: String(product.basePrice || ''),
    salePrice: String(product.salePrice || ''),
    saleStartDate: product.saleStartDate || '',
    saleEndDate: product.saleEndDate || '',
    stock: String(totalStock),
    status: product.status || 'draft',
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
        description: form.description || undefined,
        basePrice: Number(form.basePrice),
        salePrice: form.salePrice ? Number(form.salePrice) : undefined,
        saleStartDate: form.saleStartDate || undefined,
        saleEndDate: form.saleEndDate || undefined,
        stock: Number(form.stock),
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

  return (
    <div className="fixed inset-0 bg-white z-50 flex flex-col">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-white shadow-sm">
        <div className="flex items-center gap-4">
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            title="Volver al listado"
          >
            <X className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Editar producto</h2>
            <p className="text-xs text-gray-400 mt-0.5 font-mono">{product.sku}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={saving || pushing}
            className="px-4 py-2 border border-sky-200 text-sky-700 hover:bg-sky-50 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            {saving && !pushing && <Loader2 className="w-4 h-4 animate-spin" />}
            Guardar
          </button>
          <button
            onClick={handlePush}
            disabled={saving || pushing}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            {pushing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Guardar y sincronizar
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-gray-50">
        <div className="max-w-7xl mx-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-5">

          {/* Nombre */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del producto</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ej: Monitor MSI MAG 271QP QD-OLED 27'' 240Hz"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <p className="text-xs text-gray-400 mt-1">Nombre visible en StockCentral y en Falabella. Sé descriptivo: marca, modelo, características clave.</p>
          </div>

          {/* Descripción */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={5}
              placeholder="Ej: Monitor gaming QD-OLED de 27 pulgadas con resolución 2560x1440, frecuencia de actualización de 240Hz, tiempo de respuesta 0.03ms, compatible con HDR400 y AMD FreeSync Premium Pro. Ideal para gaming competitivo y trabajo creativo."
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none"
            />
            <p className="text-xs text-gray-400 mt-1">Se publica en la ficha del producto en Falabella. Incluye especificaciones técnicas, materiales, compatibilidad y usos recomendados. Sin HTML.</p>
          </div>

          {/* Precios */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Precios</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Precio base (CLP)</label>
                <input
                  type="number"
                  value={form.basePrice}
                  onChange={(e) => setForm({ ...form, basePrice: e.target.value })}
                  min="0"
                  placeholder="Ej: 599990"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <p className="text-xs text-gray-400 mt-1">Precio normal sin descuento. Se muestra tachado cuando hay oferta activa.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Precio oferta (CLP) <span className="text-gray-400 font-normal">opcional</span>
                </label>
                <input
                  type="number"
                  value={form.salePrice}
                  onChange={(e) => setForm({ ...form, salePrice: e.target.value })}
                  min="0"
                  placeholder="Ej: 499990 — dejar vacío si no hay oferta"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <p className="text-xs text-gray-400 mt-1">Precio con descuento. Debe ser menor al precio base. Requiere fechas de vigencia.</p>
              </div>
            </div>

            {form.salePrice && (
              <div className="grid grid-cols-2 gap-4 mt-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Inicio de oferta</label>
                  <input
                    type="date"
                    value={form.saleStartDate}
                    onChange={(e) => setForm({ ...form, saleStartDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  <p className="text-xs text-gray-400 mt-1">Fecha desde la que se activa el precio de oferta en Falabella.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Fin de oferta</label>
                  <input
                    type="date"
                    value={form.saleEndDate}
                    onChange={(e) => setForm({ ...form, saleEndDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                  <p className="text-xs text-gray-400 mt-1">Fecha hasta la que rige el precio oferta. Después vuelve al precio base.</p>
                </div>
              </div>
            )}
          </div>

          {/* Stock y Estado */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Inventario y estado</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Stock disponible (unidades)</label>
                <input
                  type="number"
                  value={form.stock}
                  onChange={(e) => setForm({ ...form, stock: e.target.value })}
                  min="0"
                  placeholder="Ej: 10"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <p className="text-xs text-gray-400 mt-1">Unidades disponibles en bodega. Se actualiza en Falabella al sincronizar. Si llegas a 0, el producto se pausa automáticamente.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Estado en StockCentral</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="draft">Borrador — visible solo internamente</option>
                  <option value="active">Activo — se sincroniza con marketplaces</option>
                  <option value="archived">Archivado — desactivado sin eliminarse</option>
                </select>
                <p className="text-xs text-gray-400 mt-1">Solo los productos <strong>Activos</strong> se sincronizan automáticamente con Falabella.</p>
              </div>
            </div>
          </div>

          {/* Imágenes */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Imágenes del producto</p>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              URLs de imágenes <span className="text-gray-400 font-normal">(una por línea, máx. 8)</span>
            </label>
            <textarea
              value={form.images}
              onChange={(e) => setForm({ ...form, images: e.target.value })}
              rows={4}
              placeholder={"https://mitienda.com/img/producto-frente.jpg\nhttps://mitienda.com/img/producto-lateral.jpg\nhttps://mitienda.com/img/producto-detalle.jpg"}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono resize-none"
            />
            <div className="mt-1.5 space-y-1">
              <p className="text-xs text-gray-400">• La <strong>primera URL</strong> será la imagen principal en Falabella (la que aparece en resultados de búsqueda).</p>
              <p className="text-xs text-gray-400">• Las URLs deben ser <strong>públicamente accesibles</strong> (sin contraseña ni login). Falabella descarga las imágenes desde sus servidores.</p>
              <p className="text-xs text-gray-400">• Formatos aceptados: JPG, PNG. Tamaño recomendado: mínimo 800×800px, fondo blanco.</p>
            </div>
            {imageList.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {imageList.slice(0, 8).map((url, i) => (
                  <div key={i} className="relative">
                    <img
                      src={url}
                      alt={`Imagen ${i + 1}`}
                      className="w-16 h-16 object-cover rounded-lg border border-gray-200"
                      onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = 'none' }}
                    />
                    {i === 0 && (
                      <span className="absolute bottom-0.5 left-0.5 text-[9px] bg-sky-600 text-white px-1 rounded leading-tight">Principal</span>
                    )}
                  </div>
                ))}
                {imageList.length > 8 && (
                  <p className="text-xs text-amber-600 self-center">Solo se usarán las primeras 8 imágenes.</p>
                )}
              </div>
            )}
          </div>

          </div>

          <aside className="lg:col-span-1 space-y-5">
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5">
              <MarketplaceSyncBlock productId={product.id} sku={product.sku} />
            </div>

            <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-5">
              <ParisConfigBlock product={product} />
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}

function MarketplaceSyncBlock({ productId, sku }: { productId: string; sku: string }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)

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
      <div className="bg-gray-50 rounded-lg p-3">
        <Loader2 className="w-4 h-4 animate-spin text-gray-400 mx-auto" />
      </div>
    )
  }

  if (!status || status.length === 0) {
    return (
      <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
        <p className="text-xs text-gray-500">No hay conexiones de marketplace configuradas. Crea una en Conexiones.</p>
      </div>
    )
  }

  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        Sincronización con marketplaces
      </p>
      <p className="text-xs text-gray-500 mb-3">
        SKU del producto: <code className="font-mono bg-gray-100 px-1 rounded">{sku}</code>. Detectaremos publicaciones con el mismo SKU.
      </p>
      <div className="space-y-2">
        {status.map((s: any) => (
          <div
            key={s.connectionId}
            className="flex items-center justify-between p-3 border border-gray-200 rounded-lg"
          >
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900 capitalize">
                {s.provider}{' '}
                <span className="text-xs text-gray-400 font-normal">· {s.connectionName}</span>
              </p>
              <div className="mt-1">
                {s.syncStatus === 'connected' && (
                  <span className="text-xs text-green-700 font-medium">
                    ✓ Vinculado · {s.marketplaceProductId}
                  </span>
                )}
                {s.syncStatus === 'sku_not_found' && (
                  <span className="text-xs text-amber-700">SKU no encontrado en este marketplace</span>
                )}
                {s.syncStatus === 'sku_duplicate' && (
                  <span className="text-xs text-red-700">{s.errorMessage}</span>
                )}
                {s.syncStatus === 'unlinked' && (
                  <span className="text-xs text-gray-400">No vinculado todavía</span>
                )}
                {s.syncStatus === 'pending' && (
                  <span className="text-xs text-gray-500">Pendiente</span>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => detect(s.connectionId)}
                disabled={busy === s.connectionId}
                className="px-3 py-1.5 text-xs border border-sky-200 text-sky-700 hover:bg-sky-50 rounded-md font-medium transition-colors flex items-center gap-1 disabled:opacity-50"
              >
                {busy === s.connectionId ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                Detectar SKU
              </button>
              {s.linked && (
                <button
                  onClick={() => unlink(s.connectionId)}
                  disabled={busy === s.connectionId}
                  className="px-3 py-1.5 text-xs border border-gray-200 text-gray-500 hover:bg-gray-50 rounded-md transition-colors disabled:opacity-50"
                >
                  Desvincular
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
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

function ProductFormModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({ sku: '', name: '', basePrice: '', description: '', status: 'draft' })
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await api.post('/products', { ...form, basePrice: Number(form.basePrice) })
      toast.success('Producto creado correctamente')
      onSuccess()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Error al crear el producto')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-lg shadow-2xl">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Nuevo producto</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">SKU *</label>
              <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} required className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Precio base *</label>
              <input type="number" value={form.basePrice} onChange={(e) => setForm({ ...form, basePrice: e.target.value })} required min="0" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nombre *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
              <option value="draft">Borrador</option>
              <option value="active">Activo</option>
            </select>
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
