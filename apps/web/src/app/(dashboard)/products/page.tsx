'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Loader2, Package, Edit, Trash2, Filter } from 'lucide-react'
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
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  {['SKU', 'Nombre', 'Precio base', 'Stock', 'Estado', 'Acciones'].map((h) => (
                    <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {products.map((product: any) => {
                  const totalStock = product.inventory?.reduce((sum: number, inv: any) => sum + inv.quantity, 0) || 0
                  return (
                    <tr key={product.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 text-sm font-mono text-gray-600">{product.sku}</td>
                      <td className="px-6 py-4">
                        <p className="text-sm font-medium text-gray-900">{product.name}</p>
                        {product.tags?.length > 0 && (
                          <div className="flex gap-1 mt-1">
                            {product.tags.slice(0, 2).map((tag: string) => (
                              <span key={tag} className="px-1.5 py-0.5 bg-gray-100 text-gray-500 text-xs rounded">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm font-medium text-gray-800">
                        {formatCurrency(Number(product.basePrice))}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-sm font-medium ${totalStock === 0 ? 'text-red-500' : totalStock < 10 ? 'text-amber-500' : 'text-gray-700'}`}>
                          {totalStock} uds
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
                        <div className="flex items-center gap-2">
                          <button className="p-1.5 text-gray-400 hover:text-sky-600 hover:bg-sky-50 rounded transition-colors">
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => archiveMutation.mutate(product.id)}
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
          )}

          {meta && meta.totalPages > 1 && (
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
              <p className="text-sm text-gray-500">
                {meta.total} productos — Página {meta.page} de {meta.totalPages}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => p - 1)}
                  disabled={!meta.hasPrevPage}
                  className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition-colors"
                >
                  Anterior
                </button>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!meta.hasNextPage}
                  className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50 transition-colors"
                >
                  Siguiente
                </button>
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
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
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
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition-colors">
              Cancelar
            </button>
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
