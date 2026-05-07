'use client'

import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, AlertTriangle } from 'lucide-react'
import api from '@/lib/api'
import { ProductEditModal } from '@/components/products/product-editor'

export default function ProductEditPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const queryClient = useQueryClient()

  const { data: product, isLoading, error } = useQuery({
    queryKey: ['product', params.id],
    queryFn: () => api.get(`/products/${params.id}`).then((r) => r.data),
  })

  const back = () => router.push('/products/master')

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--sc-blue-500)' }} />
      </div>
    )
  }

  if (error || !product) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <AlertTriangle className="w-10 h-10" style={{ color: 'var(--sc-warn)' }} />
        <p style={{ color: 'var(--sc-text-mid)' }}>Producto no encontrado.</p>
        <button onClick={back} className="sc-btn-ghost" style={{ padding: '8px 14px' }}>
          Volver al catálogo
        </button>
      </div>
    )
  }

  return (
    <ProductEditModal
      product={product}
      onClose={back}
      onSuccess={() => {
        queryClient.invalidateQueries({ queryKey: ['products'] })
        queryClient.invalidateQueries({ queryKey: ['product', params.id] })
        back()
      }}
    />
  )
}
