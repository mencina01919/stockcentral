'use client'

import { useState } from 'react'
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
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="p-6 border-b border-gray-100 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Editar producto</h2>
            <p className="text-xs text-gray-400 mt-0.5 font-mono">{product.sku}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Basic info */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={4}
                placeholder="Descripción completa del producto (se enviará a Falabella)"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none"
              />
            </div>
          </div>

          {/* Pricing */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Precio base (CLP)</label>
              <input
                type="number"
                value={form.basePrice}
                onChange={(e) => setForm({ ...form, basePrice: e.target.value })}
                min="0"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Precio oferta (CLP) <span className="text-gray-400 font-normal">opcional</span></label>
              <input
                type="number"
                value={form.salePrice}
                onChange={(e) => setForm({ ...form, salePrice: e.target.value })}
                min="0"
                placeholder="Dejar vacío si no aplica"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
          </div>

          {form.salePrice && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Inicio oferta</label>
                <input
                  type="date"
                  value={form.saleStartDate}
                  onChange={(e) => setForm({ ...form, saleStartDate: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fin oferta</label>
                <input
                  type="date"
                  value={form.saleEndDate}
                  onChange={(e) => setForm({ ...form, saleEndDate: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </div>
          )}

          {/* Stock & Status */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Stock</label>
              <input
                type="number"
                value={form.stock}
                onChange={(e) => setForm({ ...form, stock: e.target.value })}
                min="0"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                <option value="draft">Borrador</option>
                <option value="active">Activo</option>
                <option value="archived">Archivado</option>
              </select>
            </div>
          </div>

          {/* Images */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Imágenes <span className="text-gray-400 font-normal">(URLs públicas, una por línea, máx. 8)</span>
            </label>
            <p className="text-xs text-gray-400 mb-2">Las imágenes deben ser URLs accesibles públicamente. Se enviarán directamente a Falabella al sincronizar.</p>
            <textarea
              value={form.images}
              onChange={(e) => setForm({ ...form, images: e.target.value })}
              rows={4}
              placeholder="https://ejemplo.com/imagen1.jpg&#10;https://ejemplo.com/imagen2.jpg"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono resize-none"
            />
            {imageList.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {imageList.slice(0, 8).map((url, i) => (
                  <div key={i} className="relative group">
                    <img
                      src={url}
                      alt={`Imagen ${i + 1}`}
                      className="w-16 h-16 object-cover rounded-lg border border-gray-200"
                      onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = 'none' }}
                    />
                    {i === 0 && (
                      <span className="absolute bottom-0.5 left-0.5 text-[9px] bg-sky-600 text-white px-1 rounded">Principal</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Marketplace connections info */}
          {product._count?.marketplaceMappings > 0 && (
            <div className="bg-sky-50 rounded-lg p-3 flex items-start gap-2">
              <ExternalLink className="w-4 h-4 text-sky-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-sky-700">
                Este producto está conectado a <strong>{product._count.marketplaceMappings} canal{product._count.marketplaceMappings > 1 ? 'es' : ''}</strong>. Usa "Guardar y sincronizar" para actualizar nombre, descripción, precio, imágenes y stock en todos los marketplaces.
              </p>
            </div>
          )}
        </div>

        <div className="p-5 border-t border-gray-100 flex gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
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
            className="flex-1 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            {pushing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Guardar y sincronizar en marketplaces
          </button>
        </div>
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
