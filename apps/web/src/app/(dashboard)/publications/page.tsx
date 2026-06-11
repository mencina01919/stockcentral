'use client'

import * as React from 'react'
import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Loader2, Send, CheckCircle2, XCircle, AlertCircle, X, Plus, Package, ArrowRight, ImagePlus, Trash2, Search,
} from 'lucide-react'
import { toast } from 'sonner'
import api from '@/lib/api'
import { cn, PROVIDER_LABELS, formatCurrency } from '@/lib/utils'
import { ProviderLogo } from '@/components/provider-logo'
import { MarketplacePricingBlock } from '@/components/marketplace-pricing/marketplace-pricing-block'

// ─── ML Category Search ───────────────────────────────────────────────────────

interface MLCategory { id: string; name: string; path_from_root?: { name: string }[] }

function MLCategorySearch({ value, onChange }: { value: string; onChange: (id: string, name: string) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MLCategory[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<MLCategory | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // If value already set, show it
  useEffect(() => {
    if (value && !selected) {
      setSelected({ id: value, name: value })
    }
  }, [value, selected])

  const search = (q: string) => {
    setQuery(q)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (q.length < 2) { setResults([]); setOpen(false); return }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const r = await api.get(`/publications/ml/categories/search?q=${encodeURIComponent(q)}`)
        setResults(r.data || [])
        setOpen(true)
      } catch { setResults([]) }
      finally { setLoading(false) }
    }, 350)
  }

  const select = (cat: MLCategory) => {
    setSelected(cat)
    setQuery('')
    setOpen(false)
    onChange(cat.id, cat.name)
  }

  return (
    <div className="relative">
      {selected ? (
        <div className="flex items-center gap-2 mt-1 px-3 py-2 border border-sky-300 bg-sky-50 rounded-xl text-sm">
          <span className="font-mono text-xs text-sky-700 bg-sky-100 px-1.5 py-0.5 rounded">{selected.id}</span>
          <span className="text-gray-800 flex-1">{selected.name}</span>
          <button type="button" onClick={() => { setSelected(null); onChange('', '') }} className="text-gray-400 hover:text-red-500">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <div className="relative mt-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={e => search(e.target.value)}
            placeholder="Buscar categoría (ej: celular, zapatos, televisor...)"
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
          {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-sky-500" />}
        </div>
      )}
      {open && results.length > 0 && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
          {results.map(cat => (
            <button key={cat.id} type="button" onClick={() => select(cat)}
              className="w-full text-left px-3 py-2.5 hover:bg-sky-50 transition-colors border-b border-gray-50 last:border-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded flex-shrink-0">{cat.id}</span>
                <span className="text-sm text-gray-800">{cat.name}</span>
              </div>
              {cat.path_from_root && cat.path_from_root.length > 1 && (
                <p className="text-xs text-gray-400 mt-0.5 ml-0.5">
                  {cat.path_from_root.map((p: any) => p.name).join(' › ')}
                </p>
              )}
            </button>
          ))}
        </div>
      )}
      {value && (
        <p className="text-xs text-gray-400 mt-1">ID: <span className="font-mono">{value}</span></p>
      )}
    </div>
  )
}

// ─── ML Dynamic Attributes ────────────────────────────────────────────────────

interface MLAttr {
  id: string
  name: string
  value_type: string
  required: boolean
  values: { id: string; name: string }[]
  allowed_units: { id: string; name: string }[]
  hint?: string
}

interface MLAttrGroups { required: MLAttr[]; sellerPackage: MLAttr[]; recommended: MLAttr[] }

function MLAttrInput({ attr, formData, setValue }: { attr: MLAttr; formData: Record<string, any>; setValue: (k: string, v: any) => void }) {
  const key = `ml_attr_${attr.id}`
  const current = formData[key]

  // Enum: combobox — datalist permite elegir de la lista o escribir un valor custom
  // (los attrs ML con values son "sugerencias", no enums cerrados — value_type='string')
  if (attr.values && attr.values.length > 0) {
    const listId = `ml-${attr.id}-list`
    const inputValue = current?.value_name ?? ''
    return (
      <>
        <input
          type="text"
          list={listId}
          value={inputValue}
          onChange={e => {
            const text = e.target.value
            if (text === '') { setValue(key, null); return }
            // Si el texto coincide exactamente con un value, mandamos value_id; si no, solo value_name (custom)
            const match = attr.values.find(v => v.name.toLowerCase() === text.toLowerCase())
            setValue(key, match
              ? { id: attr.id, value_id: match.id, value_name: match.name }
              : { id: attr.id, value_name: text })
          }}
          placeholder={`Buscar o escribir...`}
          className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
        <datalist id={listId}>
          {attr.values.map(v => (
            <option key={v.id} value={v.name} />
          ))}
        </datalist>
      </>
    )
  }

  // number_unit: send value_struct
  if (attr.value_type === 'number_unit') {
    const num = current?.value_struct?.number ?? ''
    const unit = current?.value_struct?.unit ?? attr.allowed_units?.[0]?.id ?? ''
    return (
      <div className="flex gap-2 mt-1">
        <input
          type="number"
          value={num}
          onChange={e => {
            const n = e.target.value === '' ? '' : Number(e.target.value)
            const u = unit
            setValue(key, n === '' ? null : { id: attr.id, value_name: `${n} ${u}`, value_struct: { number: n, unit: u } })
          }}
          placeholder="0"
          className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
        <select
          value={unit}
          onChange={e => {
            if (num === '') return
            setValue(key, { id: attr.id, value_name: `${num} ${e.target.value}`, value_struct: { number: Number(num), unit: e.target.value } })
          }}
          className="w-24 px-2 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
        >
          {(attr.allowed_units || []).map(u => <option key={u.id} value={u.id}>{u.id}</option>)}
        </select>
      </div>
    )
  }

  // number
  if (attr.value_type === 'number') {
    return (
      <input
        type="number"
        value={current?.value_name ?? ''}
        onChange={e => setValue(key, e.target.value === '' ? null : { id: attr.id, value_name: e.target.value })}
        className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
      />
    )
  }

  // string / fallback
  return (
    <input
      type="text"
      value={current?.value_name ?? ''}
      onChange={e => setValue(key, e.target.value === '' ? null : { id: attr.id, value_name: e.target.value })}
      placeholder={attr.name}
      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
    />
  )
}

function MLAttributeFields({
  categoryId,
  formData,
  setValue,
}: {
  categoryId: string
  formData: Record<string, any>
  setValue: (k: string, v: any) => void
}) {
  const { data: groups, isLoading } = useQuery<MLAttrGroups>({
    queryKey: ['ml-cat-attrs', categoryId],
    queryFn: () => api.get(`/publications/ml/categories/${categoryId}/attributes`).then(r => r.data),
    enabled: !!categoryId,
  })

  if (!categoryId) return null
  if (isLoading) return (
    <div className="flex items-center gap-2 py-3 text-sm text-gray-400">
      <Loader2 className="w-4 h-4 animate-spin text-sky-500" />
      Cargando atributos de ML para esta categoría...
    </div>
  )
  if (!groups) return null

  const renderGroup = (title: string, items: MLAttr[], hint?: string) => {
    if (!items.length) return null
    return (
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">{title}</p>
        {hint && <p className="text-xs text-gray-400 mb-3">{hint}</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
          {items.map(attr => (
            <div key={attr.id}>
              <label className="text-sm font-medium text-gray-700">
                {attr.name} {attr.required && <span className="text-red-500">*</span>}
                <span className="ml-1 text-xs text-gray-400 font-normal font-mono">({attr.id})</span>
              </label>
              <MLAttrInput attr={attr} formData={formData} setValue={setValue} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {renderGroup('Atributos requeridos por ML', groups.required)}
      {renderGroup('Dimensiones del paquete', groups.sellerPackage,
        'Solo enteros. Dimensiones en cm, peso en gramos.')}
      {renderGroup('Atributos recomendados', groups.recommended)}
    </div>
  )
}

// ─── Paris: Family Search ─────────────────────────────────────────────────────

interface ParisFamily { id: string; name: string }

function ParisFamilySearch({ value, onChange }: { value: string; onChange: (id: string, name: string) => void }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<ParisFamily | null>(null)

  const { data: all, isLoading } = useQuery<{ results?: ParisFamily[] } | ParisFamily[]>({
    queryKey: ['paris-families'],
    queryFn: () => api.get('/publications/paris/families').then(r => r.data),
    staleTime: 10 * 60_000,
  })

  // Normalize
  const families: ParisFamily[] = Array.isArray(all)
    ? all
    : (all?.results || [])

  useEffect(() => {
    if (value && !selected) {
      const found = families.find(f => f.id === value)
      if (found) setSelected(found)
      else setSelected({ id: value, name: value })
    }
  }, [value, families, selected])

  const filtered = query.length < 2
    ? families.slice(0, 30)
    : families.filter(f => (f.name || '').toLowerCase().includes(query.toLowerCase())).slice(0, 50)

  return (
    <div className="relative">
      {selected ? (
        <div className="flex items-center gap-2 mt-1 px-3 py-2 border border-sky-300 bg-sky-50 rounded-xl text-sm">
          <span className="font-mono text-xs text-sky-700 bg-sky-100 px-1.5 py-0.5 rounded">{selected.id.slice(0, 8)}…</span>
          <span className="text-gray-800 flex-1">{selected.name}</span>
          <button type="button" onClick={() => { setSelected(null); onChange('', '') }} className="text-gray-400 hover:text-red-500">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <div className="relative mt-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            placeholder="Buscar familia (Computación, Vestuario, Hogar...)"
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
          {isLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-sky-500" />}
        </div>
      )}
      {open && !selected && filtered.length > 0 && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden max-h-72 overflow-y-auto">
          {filtered.map(f => (
            <button key={f.id} type="button" onClick={() => { setSelected(f); setOpen(false); onChange(f.id, f.name) }}
              className="w-full text-left px-3 py-2 hover:bg-sky-50 transition-colors border-b border-gray-50 last:border-0">
              <span className="text-sm text-gray-800">{f.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Paris: Category Select (depends on familyId) ─────────────────────────────

interface ParisCategory { id: string; name: string; level?: number }

function ParisCategorySelect({ familyId, value, onChange }: { familyId: string; value: string; onChange: (id: string, name: string) => void }) {
  const { data, isLoading } = useQuery<{ results?: ParisCategory[] } | ParisCategory[]>({
    queryKey: ['paris-categories', familyId],
    queryFn: () => api.get(`/publications/paris/families/${familyId}/categories`).then(r => r.data),
    enabled: !!familyId,
    staleTime: 10 * 60_000,
  })

  const cats: ParisCategory[] = Array.isArray(data) ? data : (data?.results || [])

  if (!familyId) return (
    <p className="mt-1 text-sm text-gray-400 italic">Selecciona primero una familia</p>
  )
  if (isLoading) return (
    <div className="mt-1 flex items-center gap-2 text-sm text-gray-400">
      <Loader2 className="w-4 h-4 animate-spin text-sky-500" /> Cargando categorías…
    </div>
  )
  if (!cats.length) return (
    <p className="mt-1 text-sm text-gray-400 italic">No hay categorías para esta familia</p>
  )

  return (
    <select
      value={value || ''}
      onChange={e => {
        const cat = cats.find(c => c.id === e.target.value)
        onChange(e.target.value, cat?.name || '')
      }}
      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
    >
      <option value="">Seleccionar categoría…</option>
      {cats.map(c => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
    </select>
  )
}

// ─── Paris: Dynamic Attribute Fields ──────────────────────────────────────────

interface ParisAttr {
  id: string
  name: string
  type?: 'PRODUCT' | 'VARIANT'
  attributeOptions?: { id: string; name: string }[]
  familyAttributes?: { attributeValidation?: { isRequired?: boolean; length?: number } }[]
}

function ParisAttrInput({ attr, prefix, formData, setValue }: {
  attr: ParisAttr
  prefix: 'pattr' | 'vattr'
  formData: Record<string, any>
  setValue: (k: string, v: any) => void
}) {
  const key = `paris_${prefix}_${attr.id}`
  const current = formData[key]
  const maxLen = attr.familyAttributes?.[0]?.attributeValidation?.length

  // Has predefined options (LIST attribute) → select with search for many options
  if ((attr.attributeOptions || []).length > 0) {
    const opts = attr.attributeOptions!
    // For very large option lists (Marca = thousands), show a searchable input
    if (opts.length > 30) {
      return (
        <ParisSearchableOptions
          attributeId={attr.id}
          inlineOptions={opts}
          value={current}
          onChange={v => setValue(key, v ? { id: attr.id, value: v.id, valueName: v.name } : null)}
        />
      )
    }
    return (
      <select
        value={current?.value ?? ''}
        onChange={e => {
          const opt = opts.find(o => o.id === e.target.value)
          setValue(key, opt ? { id: attr.id, value: opt.id, valueName: opt.name } : null)
        }}
        className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
      >
        <option value="">Seleccionar…</option>
        {opts.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    )
  }

  // Free text (length defines max chars)
  return (
    <input
      type="text"
      maxLength={maxLen || undefined}
      value={current?.value ?? ''}
      onChange={e => setValue(key, e.target.value === '' ? null : { id: attr.id, value: e.target.value })}
      placeholder={attr.name}
      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
    />
  )
}

// Searchable options for attributes with many options (Marca, etc.)
function ParisSearchableOptions({ attributeId, inlineOptions, value, onChange }: {
  attributeId: string
  inlineOptions: { id: string; name: string }[]
  value: any
  onChange: (v: { id: string; name: string } | null) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const debRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [serverResults, setServerResults] = useState<{ id: string; name: string }[]>([])

  // Local filter first; if user types more than 2 chars and we have lots of options, query server
  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current)
    if (query.length < 2) { setServerResults([]); return }
    debRef.current = setTimeout(async () => {
      try {
        const r = await api.get(`/publications/paris/attributes/${attributeId}/options?q=${encodeURIComponent(query)}`)
        const list = Array.isArray(r.data) ? r.data : (r.data?.results || [])
        setServerResults(list.slice(0, 200))
      } catch { setServerResults([]) }
    }, 300)
    return () => { if (debRef.current) clearTimeout(debRef.current) }
  }, [query, attributeId])

  const localResults = query.length < 2
    ? inlineOptions.slice(0, 100)
    : inlineOptions.filter(o => (o.name || '').toLowerCase().includes(query.toLowerCase())).slice(0, 200)

  const results = serverResults.length > 0 ? serverResults : localResults

  if (value?.valueName) {
    return (
      <div className="flex items-center gap-2 mt-1 px-3 py-2 border border-sky-300 bg-sky-50 rounded-xl text-sm">
        <span className="text-gray-800 flex-1">{value.valueName}</span>
        <button type="button" onClick={() => onChange(null)} className="text-gray-400 hover:text-red-500">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    )
  }

  return (
    <div className="relative">
      <div className="relative mt-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder="Buscar opción…"
          className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden max-h-96 overflow-y-auto">
          {results.map(o => (
            <button key={o.id} type="button" onClick={() => { onChange(o); setOpen(false); setQuery('') }}
              className="w-full text-left px-3 py-2 hover:bg-sky-50 transition-colors border-b border-gray-50 last:border-0 text-sm">
              {o.name}
            </button>
          ))}
          {query.length < 2 && (
            <p className="px-3 py-2 text-xs text-gray-400 italic border-t border-gray-100 sticky bottom-0 bg-white">
              Hay miles de opciones — escribe al menos 2 letras para buscar
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ParisAttributeFields({ familyId, formData, setValue }: {
  familyId: string
  formData: Record<string, any>
  setValue: (k: string, v: any) => void
}) {
  const { data: pAttrs, isLoading: pLoading } = useQuery<{ results?: ParisAttr[] } | ParisAttr[]>({
    queryKey: ['paris-attrs-product', familyId],
    queryFn: () => api.get(`/publications/paris/families/${familyId}/attributes?kind=product`).then(r => r.data),
    enabled: !!familyId,
    staleTime: 10 * 60_000,
  })
  const { data: vAttrs, isLoading: vLoading } = useQuery<{ results?: ParisAttr[] } | ParisAttr[]>({
    queryKey: ['paris-attrs-variant', familyId],
    queryFn: () => api.get(`/publications/paris/families/${familyId}/attributes?kind=variant`).then(r => r.data),
    enabled: !!familyId,
    staleTime: 10 * 60_000,
  })

  if (!familyId) return null
  if (pLoading || vLoading) return (
    <div className="flex items-center gap-2 py-3 text-sm text-gray-400">
      <Loader2 className="w-4 h-4 animate-spin text-sky-500" />
      Cargando atributos de Paris para esta familia…
    </div>
  )

  const productList: ParisAttr[] = Array.isArray(pAttrs) ? pAttrs : (pAttrs?.results || [])
  const variantList: ParisAttr[] = Array.isArray(vAttrs) ? vAttrs : (vAttrs?.results || [])

  const isRequired = (a: ParisAttr) => !!a.familyAttributes?.[0]?.attributeValidation?.isRequired

  // Sort: required first, then alphabetic
  const sortFn = (a: ParisAttr, b: ParisAttr) => {
    const ra = isRequired(a) ? 0 : 1
    const rb = isRequired(b) ? 0 : 1
    if (ra !== rb) return ra - rb
    return (a.name || '').localeCompare(b.name || '')
  }

  const sortedProduct = [...productList].sort(sortFn)
  const sortedVariant = [...variantList].sort(sortFn)

  const renderAttrGroup = (title: string, list: ParisAttr[], prefix: 'pattr' | 'vattr') => {
    if (!list.length) return null
    return (
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{title}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {list.map(a => (
            <div key={a.id}>
              <label className="text-sm font-medium text-gray-700">
                {a.name} {isRequired(a) && <span className="text-red-500">*</span>}
              </label>
              <ParisAttrInput attr={a} prefix={prefix} formData={formData} setValue={setValue} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {renderAttrGroup('Atributos del producto', sortedProduct, 'pattr')}
      {renderAttrGroup('Atributos de la variante', sortedVariant, 'vattr')}
    </div>
  )
}

// ─── Paris: Prices Editor ─────────────────────────────────────────────────────

interface ParisPriceType { id: string; name: string }

function ParisPricesEditor({ formData, setValue }: {
  formData: Record<string, any>
  setValue: (k: string, v: any) => void
}) {
  const { data: pt } = useQuery<{ results?: ParisPriceType[] } | ParisPriceType[]>({
    queryKey: ['paris-price-types'],
    queryFn: () => api.get('/publications/paris/price-types').then(r => r.data),
    staleTime: 60 * 60_000,
  })
  const types: ParisPriceType[] = Array.isArray(pt) ? pt : (pt?.results || [])

  const prices: any[] = Array.isArray(formData.parisPrices) ? formData.parisPrices : []

  const setPrice = (idx: number, partial: Record<string, any>) => {
    const next = [...prices]
    next[idx] = { ...next[idx], ...partial }
    setValue('parisPrices', next)
  }
  const addPrice = () => setValue('parisPrices', [...prices, { priceTypeId: '', value: '' }])
  const removePrice = (idx: number) => {
    const next = prices.filter((_, i) => i !== idx)
    setValue('parisPrices', next)
  }

  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Precios</p>
      <div className="space-y-3">
        {prices.map((p, idx) => {
          const isOffer = (types.find(t => t.id === p.priceTypeId)?.name || '').toLowerCase().includes('oferta')
          return (
            <div key={idx} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-4">
                <label className="text-xs text-gray-500">Tipo</label>
                <select
                  value={p.priceTypeId || ''}
                  onChange={e => setPrice(idx, { priceTypeId: e.target.value })}
                  className="mt-1 w-full px-2 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="">Seleccionar…</option>
                  {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div className="col-span-3">
                <label className="text-xs text-gray-500">Valor (CLP)</label>
                <input
                  type="number"
                  min="0"
                  value={p.value || ''}
                  onChange={e => setPrice(idx, { value: e.target.value })}
                  className="mt-1 w-full px-2 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              {isOffer && (
                <>
                  <div className="col-span-2">
                    <label className="text-xs text-gray-500">Desde</label>
                    <input type="date" value={p.startDate || ''} onChange={e => setPrice(idx, { startDate: e.target.value })}
                      className="mt-1 w-full px-2 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-sky-500" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-gray-500">Hasta</label>
                    <input type="date" value={p.endDate || ''} onChange={e => setPrice(idx, { endDate: e.target.value })}
                      className="mt-1 w-full px-2 py-2 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-sky-500" />
                  </div>
                </>
              )}
              <div className={isOffer ? 'col-span-1' : 'col-span-5 text-right'}>
                <button type="button" onClick={() => removePrice(idx)} className="text-gray-400 hover:text-red-500 p-2">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          )
        })}
        <button type="button" onClick={addPrice} className="text-sm text-sky-600 hover:text-sky-700 inline-flex items-center gap-1">
          <Plus className="w-4 h-4" /> Agregar precio
        </button>
        {prices.length === 0 && (
          <p className="text-xs text-gray-400 italic">
            Agrega al menos un precio (tipo "Precio") para que el producto se publique con valor.
          </p>
        )}
      </div>
    </div>
  )
}

const LIDER_CATEGORY_LABELS: Record<string, string> = {
  'Animal Accessories':                    'Accesorios para Animales',
  'Animal Food':                           'Alimentos para Animales',
  'Animal Health & Grooming':              'Salud e Higiene Animal',
  'Animal Other':                          'Otros — Animales',
  'Art & Craft':                           'Arte y Manualidades',
  'Baby Clothing':                         'Ropa de Bebé',
  'Baby Diapering, Care, & Other':         'Pañales, Cuidado e Higiene Bebé',
  'Baby Food':                             'Alimentos para Bebé',
  'Baby Furniture':                        'Muebles de Bebé',
  'Baby Toys':                             'Juguetes para Bebé',
  'Baby Transport':                        'Transporte de Bebé',
  'Beauty, Personal Care, & Hygiene':      'Belleza, Cuidado Personal e Higiene',
  'Bedding':                               'Ropa de Cama',
  'Books & Magazines':                     'Libros y Revistas',
  'Building Supply':                       'Materiales de Construcción',
  'Cameras & Lenses':                      'Cámaras y Lentes',
  'Carriers & Accessories':                'Portabebés y Accesorios',
  'Cases & Bags':                          'Fundas y Bolsos',
  'Cell Phones':                           'Teléfonos Celulares',
  'Ceremonial Clothing & Accessories':     'Ropa y Accesorios de Ceremonia',
  'Clothing':                              'Ropa y Vestuario',
  'Computer Components':                   'Componentes de Computador',
  'Computers':                             'Computadores',
  'Costumes':                              'Disfraces',
  'Cycling':                               'Ciclismo',
  'Decorations & Favors':                  'Decoraciones y Souvenirs',
  'Electrical':                            'Eléctrico',
  'Electronics Accessories':               'Accesorios Electrónicos',
  'Electronics Cables':                    'Cables Electrónicos',
  'Electronics Other':                     'Otros — Electrónica',
  'Food & Beverage':                       'Alimentos y Bebidas',
  'Footwear':                              'Calzado',
  'Fuels & Lubricants':                    'Combustibles y Lubricantes',
  'Funeral':                               'Artículos Fúnebres',
  'Furniture':                             'Muebles',
  'Garden & Patio':                        'Jardín y Patio',
  'Gift Supply & Awards':                  'Regalos y Premios',
  'Grills & Outdoor Cooking':              'Parrillas y Cocina Exterior',
  'Hardware':                              'Ferretería',
  'Health & Beauty Electronics':           'Electrónica de Salud y Belleza',
  'Home Decor, Kitchen, & Other':          'Decoración Hogar, Cocina y Otros',
  'Household Cleaning Products & Supplies':'Productos de Limpieza del Hogar',
  'Instrument Accessories':               'Accesorios para Instrumentos',
  'Jewelry':                               'Joyería',
  'Land Vehicles':                         'Vehículos Terrestres',
  'Large Appliances':                      'Electrodomésticos de Gran Tamaño',
  'Medical Aids & Equipment':              'Ayudas y Equipos Médicos',
  'Medicine & Supplements':               'Medicamentos y Suplementos',
  'Movies':                                'Películas',
  'Music':                                 'Música',
  'Music Cases & Bags':                    'Estuches y Bolsos para Música',
  'Musical Instruments':                   'Instrumentos Musicales',
  'Office':                                'Oficina',
  'Optical':                               'Óptica',
  'Optics':                                'Óptica y Visión',
  'Other':                                 'Otros',
  'Photo Accessories':                     'Accesorios de Fotografía',
  'Plumbing & HVAC':                       'Gasfitería y Climatización',
  'Printers, Scanners, & Imaging':         'Impresoras, Escáneres e Imagen',
  'Safety & Emergency':                    'Seguridad y Emergencias',
  'Software':                              'Software',
  'Sound & Recording':                     'Sonido y Grabación',
  'Sport & Recreation Other':              'Otros — Deporte y Recreación',
  'Storage':                               'Almacenamiento',
  'Tires':                                 'Neumáticos',
  'Tools':                                 'Herramientas',
  'Tools & Hardware Other':               'Otros — Herramientas y Ferretería',
  'Toys':                                  'Juguetes',
  'TV Shows':                              'Series de TV',
  'TVs & Video Displays':                  'Televisores y Pantallas',
  'Vehicle Other':                         'Otros — Vehículos',
  'Vehicle Parts & Accessories':           'Partes y Accesorios de Vehículos',
  'Video Games':                           'Videojuegos',
  'Video Projectors':                      'Proyectores de Video',
  'Watches':                               'Relojes',
  'Watercraft':                            'Embarcaciones',
  'Wheels & Wheel Components':             'Ruedas y Componentes',
  'Kitchen Appliances':                    'Electrodomésticos de Cocina',
}

const SYNC_STATUS_INFO: Record<string, { label: string; color: string; icon: any }> = {
  // Estados "vinculados" — el producto YA está en el marketplace. Aceptamos
  // tanto 'connected' (estado al publicar) como 'success' (estado tras el
  // último sync OK). Antes solo manejábamos 'connected' y los items con
  // 'success' caían al fallback 'unlinked' mostrando "Sin vincular".
  connected:     { label: 'Publicado',          color: 'text-green-600',  icon: CheckCircle2 },
  success:       { label: 'Publicado',          color: 'text-green-600',  icon: CheckCircle2 },
  error:         { label: 'Error',              color: 'text-red-600',    icon: XCircle },
  pending:       { label: 'Pendiente',          color: 'text-yellow-600', icon: AlertCircle },
  sku_not_found: { label: 'SKU no encontrado',  color: 'text-gray-400',   icon: AlertCircle },
  sku_duplicate: { label: 'SKU duplicado',      color: 'text-orange-500', icon: AlertCircle },
  unlinked:      { label: 'Sin vincular',       color: 'text-gray-400',   icon: AlertCircle },
}

// Statuses que cuentan como "el producto está vinculado al marketplace"
const LINKED_STATUSES = new Set(['connected', 'success'])

// ─── Falabella Category Search ───────────────────────────────────────────────

interface FBCategory { id: string; name: string; hasChildren: boolean; parentPath?: string[] }

interface FBTreeNode {
  CategoryId: string
  Name: string
  Children?: { Category?: FBTreeNode | FBTreeNode[] } | ''
  AttributeSetId?: string
}

const FB_RECENT_KEY = 'fb-recent-categories'
const FB_RECENT_MAX = 5

function loadRecent(): FBCategory[] {
  if (typeof window === 'undefined') return []
  try { return JSON.parse(localStorage.getItem(FB_RECENT_KEY) || '[]') } catch { return [] }
}
function saveRecent(cat: FBCategory) {
  if (typeof window === 'undefined') return
  try {
    const cur = loadRecent().filter(c => c.id !== cat.id)
    cur.unshift(cat)
    localStorage.setItem(FB_RECENT_KEY, JSON.stringify(cur.slice(0, FB_RECENT_MAX)))
  } catch { /* ignore quota errors */ }
}

// Strip diacritics + lowercase for filter comparison
function fbNorm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
}

// Decide whether a node (and its subtree) contains any text matching the filter.
// Returns true if the node's own name matches, or any descendant matches.
function fbNodeMatches(node: FBTreeNode, filterNorm: string): boolean {
  if (!filterNorm) return true
  if (fbNorm(node.Name).includes(filterNorm)) return true
  const childRaw = node.Children && typeof node.Children === 'object' ? node.Children.Category : undefined
  const kids = Array.isArray(childRaw) ? childRaw : (childRaw ? [childRaw] : [])
  return kids.some(k => fbNodeMatches(k, filterNorm))
}

// Renders one branch of the tree, with click-to-expand UX.
// `filterNorm`: normalized filter string from the tree's own search box.
//   - if empty, default expansion (depth 0 open).
//   - if set, branches auto-expand when they (or any descendant) match.
function FBTreeBranch({
  node, depth = 0, onSelect, parentPath = [], filterNorm = '',
}: { node: FBTreeNode; depth?: number; onSelect: (cat: FBCategory) => void; parentPath?: string[]; filterNorm?: string }) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const childrenRaw = node.Children && typeof node.Children === 'object' ? node.Children.Category : undefined
  const children = Array.isArray(childrenRaw) ? childrenRaw : (childrenRaw ? [childrenRaw] : [])
  const isLeaf = children.length === 0
  const newPath = [...parentPath, node.Name]

  // Filtering rules
  const nameMatches = filterNorm ? fbNorm(node.Name).includes(filterNorm) : true
  const subtreeMatches = filterNorm
    ? children.some(k => fbNodeMatches(k, filterNorm))
    : true

  // Hide nodes that don't match and have no matching descendants
  if (filterNorm && !nameMatches && !subtreeMatches) return null

  // Auto-expand when filter is active and a match is in the subtree.
  // Otherwise honor user's manual toggle, with depth-0 default open.
  const autoOpen = filterNorm ? subtreeMatches || nameMatches : depth === 0
  const open = userOpen ?? autoOpen

  if (isLeaf) {
    return (
      <button
        type="button"
        onClick={() => onSelect({ id: String(node.CategoryId), name: node.Name, hasChildren: false, parentPath })}
        className="flex items-center gap-2 w-full text-left px-2 py-1.5 hover:bg-sky-50 rounded text-sm"
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        <span className="text-gray-300 flex-shrink-0">·</span>
        <span className="font-mono text-xs text-gray-400 bg-gray-50 px-1 rounded">{node.CategoryId}</span>
        <span className={cn('truncate', nameMatches && filterNorm ? 'text-sky-700 font-medium' : 'text-gray-700')}>
          {node.Name}
        </span>
      </button>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setUserOpen(o => !(o ?? autoOpen))}
        className="flex items-center gap-2 w-full text-left px-2 py-1.5 hover:bg-gray-50 rounded text-sm font-medium"
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        <span className={cn('text-gray-400 flex-shrink-0 transition-transform', open && 'rotate-90')}>▶</span>
        <span className={cn('truncate', nameMatches && filterNorm ? 'text-sky-700' : 'text-gray-800')}>
          {node.Name}
        </span>
        <span className="text-xs text-gray-400 ml-auto">{children.length}</span>
      </button>
      {open && (
        <div>
          {children.map(child => (
            <FBTreeBranch key={child.CategoryId} node={child} depth={depth + 1} onSelect={onSelect} parentPath={newPath} filterNorm={filterNorm} />
          ))}
        </div>
      )}
    </div>
  )
}

function FalabellaCategorySearch({ value, onChange }: { value: string; onChange: (id: string, name: string) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FBCategory[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<FBCategory | null>(null)
  const [recent, setRecent] = useState<FBCategory[]>([])
  const [showTree, setShowTree] = useState(false)
  const [treeFilter, setTreeFilter] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputWrapRef = useRef<HTMLDivElement | null>(null)

  // Load recents from localStorage on mount
  useEffect(() => { setRecent(loadRecent()) }, [])

  useEffect(() => {
    if (value && !selected) setSelected({ id: value, name: value, hasChildren: false })
  }, [value, selected])

  // Lazy-load full tree only when the user opens the tree browser
  const { data: tree, isLoading: treeLoading } = useQuery<FBTreeNode[]>({
    queryKey: ['fb-category-tree'],
    queryFn: () => api.get('/publications/falabella/categories/tree').then(r => r.data),
    enabled: showTree,
    staleTime: 60 * 60 * 1000, // tree rarely changes
  })

  // Click-outside dismiss
  useEffect(() => {
    if (!open && !showTree) return
    const onClick = (e: MouseEvent) => {
      if (inputWrapRef.current && !inputWrapRef.current.contains(e.target as Node)) {
        setOpen(false)
        setShowTree(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open, showTree])

  const search = (q: string) => {
    setQuery(q)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (q.length < 2) { setResults([]); return }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const r = await api.get(`/publications/falabella/categories/search?q=${encodeURIComponent(q)}`)
        setResults(r.data || [])
        setOpen(true)
      } catch { setResults([]) }
      finally { setLoading(false) }
    }, 350)
  }

  const select = (cat: FBCategory) => {
    setSelected(cat)
    setQuery('')
    setOpen(false)
    setShowTree(false)
    setTreeFilter('')
    setResults([])
    saveRecent(cat)
    setRecent(loadRecent())
    onChange(cat.id, cat.name)
  }

  const clearSelection = () => {
    setSelected(null)
    onChange('', '')
  }

  // Highlight matching tokens in the category name (returns React fragments).
  const highlight = (text: string, q: string): React.ReactNode => {
    if (!q || q.length < 2) return text
    const tokens = q.toLowerCase().split(/\s+/).filter(t => t.length >= 2)
    if (tokens.length === 0) return text
    const escaped = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    const re = new RegExp(`(${escaped})`, 'gi')
    const parts = text.split(re)
    return parts.map((part, i) =>
      i % 2 === 1
        ? <mark key={i} className="bg-yellow-100 text-gray-900 rounded px-0.5">{part}</mark>
        : <span key={i}>{part}</span>
    )
  }

  if (selected) {
    return (
      <div className="mt-1 flex items-center gap-2 px-3 py-2 border border-sky-300 bg-sky-50 rounded-xl text-sm">
        <span className="font-mono text-xs text-sky-700 bg-sky-100 px-1.5 py-0.5 rounded">{selected.id}</span>
        <span className="text-gray-800 flex-1 truncate">{selected.name}</span>
        {selected.parentPath && selected.parentPath.length > 0 && (
          <span className="hidden md:inline text-xs text-gray-500 truncate">{selected.parentPath.join(' › ')}</span>
        )}
        <button type="button" onClick={clearSelection} className="text-gray-400 hover:text-red-500">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    )
  }

  return (
    <div ref={inputWrapRef} className="relative">
      <div className="mt-1 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={e => search(e.target.value)}
            onFocus={() => { if (results.length || recent.length) setOpen(true) }}
            placeholder="Buscar categoría (ej: notebook, audífonos, polera...)"
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
          {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-sky-500" />}
        </div>
        <button
          type="button"
          onClick={() => { setShowTree(s => !s); setOpen(false) }}
          className={cn(
            'px-3 py-2 border rounded-xl text-sm font-medium transition-all flex items-center gap-1.5',
            showTree ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50',
          )}
          title="Examinar todas las categorías"
        >
          <Package className="w-4 h-4" />
          <span className="hidden sm:inline">Examinar</span>
        </button>
      </div>

      {/* Search results dropdown */}
      {open && !showTree && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden max-h-96 overflow-y-auto">
          {recent.length > 0 && query.length < 2 && (
            <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
              <p className="text-xs text-gray-400 mb-1.5">Recientes</p>
              <div className="flex flex-wrap gap-1">
                {recent.map(r => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => select(r)}
                    className="px-2 py-1 bg-white border border-gray-200 rounded-lg text-xs hover:bg-sky-50 hover:border-sky-300"
                  >
                    <span className="font-mono text-gray-400 mr-1">{r.id}</span>
                    {r.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {results.length === 0 && query.length >= 2 && !loading && (
            <p className="px-3 py-4 text-sm text-gray-400 text-center">
              Sin resultados para "{query}". Prueba con otra palabra o usa <strong>Examinar</strong>.
            </p>
          )}
          {results.map((cat, idx) => (
            <button
              key={`${cat.id}-${idx}`}
              type="button"
              onClick={() => select(cat)}
              className="w-full text-left px-3 py-2.5 hover:bg-sky-50 transition-colors border-b border-gray-50 last:border-0"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded flex-shrink-0">{cat.id}</span>
                <span className="text-sm text-gray-800 truncate">{highlight(cat.name, query)}</span>
              </div>
              {cat.parentPath && cat.parentPath.length > 0 && (
                <p className="text-xs text-gray-400 mt-0.5 ml-0.5 truncate">{cat.parentPath.join(' › ')}</p>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Tree browser */}
      {showTree && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
          <div className="px-3 py-2 border-b bg-gray-50 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-gray-600 whitespace-nowrap">Examinar categorías</p>
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                type="text"
                value={treeFilter}
                onChange={e => setTreeFilter(e.target.value)}
                placeholder="Filtrar árbol..."
                className="w-full pl-8 pr-7 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              {treeFilter && (
                <button
                  type="button"
                  onClick={() => setTreeFilter('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <button type="button" onClick={() => { setShowTree(false); setTreeFilter('') }} className="text-gray-400 hover:text-red-500">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto py-1">
            {treeLoading && (
              <div className="flex items-center justify-center py-6 gap-2 text-sm text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" /> Cargando árbol…
              </div>
            )}
            {!treeLoading && (() => {
              const filterNorm = fbNorm(treeFilter.trim())
              const visibleRoots = (tree || []).filter(n => !filterNorm || fbNodeMatches(n, filterNorm))
              if (filterNorm && visibleRoots.length === 0) {
                return (
                  <p className="px-3 py-6 text-sm text-gray-400 text-center">
                    Sin coincidencias para "{treeFilter}"
                  </p>
                )
              }
              return visibleRoots.map(node => (
                <FBTreeBranch key={node.CategoryId} node={node} onSelect={select} filterNorm={filterNorm} />
              ))
            })()}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Falabella Brand Search ──────────────────────────────────────────────────

interface FBBrand { id: string; name: string }

function FalabellaBrandSearch({ value, onChange }: { value: string; onChange: (id: string, name: string) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FBBrand[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<FBBrand | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (value && !selected) setSelected({ id: value, name: value })
  }, [value, selected])

  const search = (q: string) => {
    setQuery(q)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (q.length < 2) { setResults([]); setOpen(false); return }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const r = await api.get(`/publications/falabella/brands/search?q=${encodeURIComponent(q)}`)
        setResults(r.data || [])
        setOpen(true)
      } catch { setResults([]) }
      finally { setLoading(false) }
    }, 350)
  }

  const select = (b: FBBrand) => {
    setSelected(b)
    setQuery('')
    setOpen(false)
    onChange(b.id, b.name)
  }

  return (
    <div className="relative">
      {selected ? (
        <div className="flex items-center gap-2 mt-1 px-3 py-2 border border-sky-300 bg-sky-50 rounded-xl text-sm">
          <span className="font-mono text-xs text-sky-700 bg-sky-100 px-1.5 py-0.5 rounded">{selected.id}</span>
          <span className="text-gray-800 flex-1">{selected.name}</span>
          <button type="button" onClick={() => { setSelected(null); onChange('', '') }} className="text-gray-400 hover:text-red-500">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <div className="relative mt-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text" value={query} onChange={e => search(e.target.value)}
            placeholder="Buscar marca autorizada..."
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
          {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-sky-500" />}
        </div>
      )}
      {open && results.length > 0 && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden max-h-72 overflow-y-auto">
          {results.map(b => (
            <button key={b.id} type="button" onClick={() => select(b)}
              className="w-full text-left px-3 py-2 hover:bg-sky-50 transition-colors border-b border-gray-50 last:border-0 flex items-center gap-2">
              <span className="font-mono text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded flex-shrink-0">{b.id}</span>
              <span className="text-sm text-gray-800">{b.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Falabella Dynamic Attributes ────────────────────────────────────────────

interface FBAttribute {
  name: string
  feedName: string
  label: string
  description?: string
  groupName: string
  inputType: string
  isMandatory: boolean
  maxLength?: number
  exampleValue?: string
  options: { id: string; name: string; isDefault: boolean }[]
}

interface FBAttrGroups {
  categoryId: string
  total: number
  mandatoryCount: number
  groups: { name: string; items: FBAttribute[] }[]
}

function FalabellaAttrInput({ attr, value, onChange }: { attr: FBAttribute; value: any; onChange: (v: any) => void }) {
  // Dropdown / multipleselect: use option ids as the stored value (that's what Falabella expects in the feed)
  if (attr.options && attr.options.length > 0) {
    if (attr.inputType === 'multipleselect') {
      const selected: string[] = Array.isArray(value) ? value : []
      const toggle = (id: string) => {
        const next = selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id]
        onChange(next)
      }
      return (
        <div className="mt-1 max-h-32 overflow-y-auto border border-gray-200 rounded-xl p-2 space-y-1">
          {attr.options.map(o => (
            <label key={o.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded">
              <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggle(o.id)}
                className="w-3.5 h-3.5 rounded border-gray-300 text-sky-600" />
              <span>{o.name}</span>
            </label>
          ))}
        </div>
      )
    }
    return (
      <select value={value ?? ''} onChange={e => onChange(e.target.value)}
        className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
        <option value="">Seleccionar...</option>
        {attr.options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    )
  }

  if (attr.inputType === 'numberfield') {
    return (
      <input type="number" value={value ?? ''} onChange={e => onChange(e.target.value)}
        placeholder={attr.exampleValue}
        className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
    )
  }

  if (attr.inputType === 'textarea') {
    return (
      <textarea value={value ?? ''} onChange={e => onChange(e.target.value)} rows={3}
        maxLength={attr.maxLength} placeholder={attr.exampleValue}
        className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none" />
    )
  }

  if (attr.inputType === 'datefield') {
    return (
      <input type="date" value={value ?? ''} onChange={e => onChange(e.target.value)}
        className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
    )
  }

  // textfield (default)
  return (
    <input type="text" value={value ?? ''} onChange={e => onChange(e.target.value)}
      maxLength={attr.maxLength} placeholder={attr.exampleValue}
      className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
  )
}

function FalabellaAttributeFields({
  categoryId, formData, setValue,
}: { categoryId: string; formData: Record<string, any>; setValue: (k: string, v: any) => void }) {
  const { data, isLoading } = useQuery<FBAttrGroups>({
    queryKey: ['fb-cat-attrs', categoryId],
    queryFn: () => api.get(`/publications/falabella/categories/${categoryId}/attributes`).then(r => r.data),
    enabled: !!categoryId,
  })

  if (!categoryId) return null
  if (isLoading) return (
    <div className="flex items-center gap-2 py-3 text-sm text-gray-400">
      <Loader2 className="w-4 h-4 animate-spin text-sky-500" />
      Cargando atributos de Falabella para esta categoría...
    </div>
  )
  if (!data) return null

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 px-3 py-2 bg-sky-50 border border-sky-100 rounded-xl text-xs text-sky-800">
        <AlertCircle className="w-4 h-4" />
        <span>{data.total} atributos · {data.mandatoryCount} obligatorios</span>
      </div>
      {data.groups.map(group => (
        <div key={group.name}>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{group.name}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {group.items.map(attr => {
              const isWide = attr.inputType === 'textarea' || attr.inputType === 'multipleselect'
              const key = `fb_attr_${attr.feedName}`
              // Brand is a special case: render the brand search widget instead
              if (attr.feedName === 'Brand') {
                return (
                  <div key={attr.feedName} className="md:col-span-2">
                    <label className="text-sm font-medium text-gray-700">
                      {attr.label} {attr.isMandatory && <span className="text-red-500">*</span>}
                    </label>
                    {attr.description && <p className="text-xs text-gray-400 mt-0.5">{attr.description.split('//')[0].trim()}</p>}
                    <FalabellaBrandSearch
                      value={formData[key] ?? ''}
                      onChange={(_id, name) => setValue(key, name)}
                    />
                  </div>
                )
              }
              return (
                <div key={attr.feedName} className={isWide ? 'md:col-span-2' : ''}>
                  <label className="text-sm font-medium text-gray-700">
                    {attr.label} {attr.isMandatory && <span className="text-red-500">*</span>}
                    <span className="ml-1 text-xs text-gray-400 font-normal font-mono">({attr.feedName})</span>
                  </label>
                  {attr.description && (
                    <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{attr.description.split('//')[0].trim()}</p>
                  )}
                  <FalabellaAttrInput
                    attr={attr}
                    value={formData[key]}
                    onChange={v => setValue(key, v)}
                  />
                  {attr.maxLength && (
                    <p className="text-xs text-gray-400 mt-0.5 text-right">
                      {String(formData[key] ?? '').length} / {attr.maxLength}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

type Mode = 'from-catalog' | 'direct'

// ─── ML Catalog Search ───────────────────────────────────────────────────────

interface MLCatalogProduct {
  id: string
  name: string
  family_name: string
  domain_id?: string
  category_id?: string
  status?: string
  pictures?: string[]
  attributes?: any[]
}

function MLCatalogSearch({
  categoryId,
  onSelect,
}: {
  categoryId?: string
  onSelect: (product: MLCatalogProduct) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MLCatalogProduct[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = (q: string) => {
    setQuery(q)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (q.length < 2) { setResults([]); setOpen(false); return }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ q })
        if (categoryId) params.set('category', categoryId)
        const r = await api.get(`/publications/ml/catalog/search?${params.toString()}`)
        setResults(r.data || [])
        setOpen(true)
      } catch { setResults([]) }
      finally { setLoading(false) }
    }, 350)
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={e => search(e.target.value)}
          placeholder="Buscar en catálogo ML (ej: Ryzen 5 5600, RTX 4060, mouse logitech...)"
          className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-sky-500" />}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden max-h-96 overflow-y-auto">
          {results.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => { onSelect(p); setOpen(false); setQuery('') }}
              className="w-full text-left px-3 py-2.5 hover:bg-sky-50 transition-colors border-b border-gray-50 last:border-0 flex gap-3 items-center"
            >
              {p.pictures?.[0] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.pictures[0]} alt="" className="w-10 h-10 rounded-lg object-cover bg-gray-50 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800 truncate">{p.name}</p>
                <p className="text-xs text-gray-400 mt-0.5 flex gap-2">
                  <span className="font-mono">{p.id}</span>
                  {p.family_name && <span>· {p.family_name}</span>}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
      {open && !loading && results.length === 0 && query.length >= 2 && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-center text-sm text-gray-400">
          Sin resultados en el catálogo de ML
        </div>
      )}
    </div>
  )
}

// ─── ML Validate Button ──────────────────────────────────────────────────────

function MLValidateButton({ buildPayload }: { buildPayload: () => Record<string, any> }) {
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const validate = async () => {
    setLoading(true); setResult(null)
    try {
      const payload = buildPayload()
      const r = await api.post('/publications/ml/validate', { payload })
      setResult(r.data)
    } catch (e: any) {
      setResult({ valid: false, errors: [{ message: e.response?.data?.message || e.message, type: 'error' }] })
    } finally { setLoading(false) }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={validate}
        disabled={loading}
        className="px-4 py-2 border border-sky-200 bg-sky-50 text-sky-700 rounded-xl text-sm font-medium hover:bg-sky-100 disabled:opacity-50 flex items-center gap-2"
      >
        {loading
          ? <><Loader2 className="w-4 h-4 animate-spin" /> Validando...</>
          : <><CheckCircle2 className="w-4 h-4" /> Validar antes de publicar</>
        }
      </button>
      {result && (
        <div className={cn(
          'rounded-xl p-3 text-sm',
          result.valid ? 'bg-green-50 border border-green-200 text-green-800' : 'bg-red-50 border border-red-200 text-red-800',
        )}>
          {result.valid ? (
            <p className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Listo para publicar</p>
          ) : (
            <div>
              <p className="font-medium mb-1 flex items-center gap-2"><XCircle className="w-4 h-4" /> {result.rawMessage || 'Validación falló'}</p>
              <ul className="space-y-1 mt-2 text-xs">
                {(result.errors || []).map((err: any, i: number) => (
                  <li key={i} className="pl-4 border-l-2 border-red-200">
                    <span className="font-mono text-red-700">{err.code}</span>: {err.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── ImageInput ──────────────────────────────────────────────────────────────

function ImageInput({ value, onChange, hint }: { value: string[]; onChange: (v: string[]) => void; hint?: string }) {
  const urls: string[] = Array.isArray(value) ? value : []

  const addUrl = () => onChange([...urls, ''])
  const removeUrl = (i: number) => onChange(urls.filter((_, idx) => idx !== i))
  const setUrl = (i: number, v: string) => {
    const next = [...urls]
    next[i] = v
    onChange(next)
  }

  return (
    <div className="space-y-2">
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
      {urls.map((url, i) => (
        <div key={i} className="flex gap-2 items-center">
          {url && (
            <div className="w-10 h-10 rounded-lg border border-gray-200 overflow-hidden flex-shrink-0 bg-gray-50">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
            </div>
          )}
          <input
            type="url"
            value={url}
            onChange={e => setUrl(i, e.target.value)}
            placeholder="https://ejemplo.com/imagen.jpg"
            className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
          <button type="button" onClick={() => removeUrl(i)} className="text-gray-400 hover:text-red-500 transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addUrl}
        className="flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 rounded-xl text-sm text-gray-500 hover:border-sky-400 hover:text-sky-600 transition-colors w-full justify-center"
      >
        <ImagePlus className="w-4 h-4" />
        Agregar URL de imagen
      </button>
    </div>
  )
}

// ─── FieldRenderer ───────────────────────────────────────────────────────────

function FieldRenderer({
  field, value, onChange, provider, formData, setFormData,
}: {
  field: any
  value: any
  onChange: (v: any) => void
  provider?: string
  formData?: Record<string, any>
  setFormData?: (fn: (prev: Record<string, any>) => Record<string, any>) => void
}) {
  // ML category field: use search widget
  if (field.key === 'categoryId' && provider === 'mercadolibre') {
    return (
      <MLCategorySearch
        value={value ?? ''}
        onChange={(id, _name) => onChange(id)}
      />
    )
  }

  // Falabella category field: use search widget
  if (field.key === 'PrimaryCategory' && provider === 'falabella') {
    return (
      <FalabellaCategorySearch
        value={value ?? ''}
        onChange={(id, _name) => onChange(id)}
      />
    )
  }

  // Paris family selector
  if (field.key === 'familyId' && provider === 'paris') {
    return (
      <ParisFamilySearch
        value={value ?? ''}
        onChange={(id, _name) => {
          // When family changes, reset categoryId and clear all dynamic attrs
          if (setFormData) {
            setFormData(prev => {
              const next: Record<string, any> = { ...prev, familyId: id, categoryId: '' }
              for (const k of Object.keys(next)) {
                if (k.startsWith('paris_pattr_') || k.startsWith('paris_vattr_')) delete next[k]
              }
              return next
            })
          } else {
            onChange(id)
          }
        }}
      />
    )
  }

  // Paris category selector (depends on familyId)
  if (field.key === 'categoryId' && provider === 'paris') {
    const familyId = formData?.familyId || ''
    return (
      <ParisCategorySelect
        familyId={familyId}
        value={value ?? ''}
        onChange={(id, _name) => onChange(id)}
      />
    )
  }

  if (field.type === 'images') {
    return (
      <ImageInput
        value={value ?? []}
        onChange={onChange}
        hint={field.hint}
      />
    )
  }

  if (field.type === 'select') {
    return (
      <select
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
      >
        <option value="">Seleccionar...</option>
        {field.options?.map((o: any) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    )
  }

  if (field.type === 'textarea') {
    const maxLength: number | undefined = field.maxLength
    const len = typeof value === 'string' ? value.length : 0
    return (
      <div>
        <textarea
          value={value ?? ''}
          onChange={e => {
            let v = e.target.value
            if (maxLength && v.length > maxLength) v = v.slice(0, maxLength)
            onChange(v)
          }}
          rows={3}
          maxLength={maxLength}
          placeholder={field.placeholder}
          className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none"
        />
        {maxLength && (
          <p className={`mt-1 text-xs text-right ${len >= maxLength ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
            {len}/{maxLength}
          </p>
        )}
      </div>
    )
  }

  if (field.type === 'boolean') {
    return (
      <div className="mt-2 flex items-center gap-2">
        <input
          type="checkbox"
          id={`f-${field.key}`}
          checked={!!value}
          onChange={e => onChange(e.target.checked)}
          className="w-4 h-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500"
        />
        <label htmlFor={`f-${field.key}`} className="text-sm text-gray-600">Sí</label>
      </div>
    )
  }

  // Input de texto/número/url. Si el field define maxLength, mostramos un
  // contador "X/MAX" debajo y limitamos el length nativamente. Crítico
  // para family_name de ML (60 chars) — sin el contador el usuario no
  // sabe cuánto le queda y ML rechaza la publicación al sobrepasarlo.
  const isTextish = field.type !== 'number' && field.type !== 'url'
  const maxLength: number | undefined = field.maxLength
  const len = typeof value === 'string' ? value.length : 0
  return (
    <div>
      <input
        type={field.type === 'number' ? 'number' : field.type === 'url' ? 'url' : 'text'}
        value={value ?? ''}
        onChange={e => {
          let v: any = field.type === 'number' ? Number(e.target.value) : e.target.value
          if (isTextish && maxLength && typeof v === 'string' && v.length > maxLength) {
            v = v.slice(0, maxLength)
          }
          onChange(v)
        }}
        placeholder={field.placeholder}
        maxLength={isTextish && maxLength ? maxLength : undefined}
        className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
      />
      {isTextish && maxLength && (
        <p className={`mt-1 text-xs text-right ${len >= maxLength ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
          {len}/{maxLength}
        </p>
      )}
    </div>
  )
}

// ─── FormFields ──────────────────────────────────────────────────────────────

// ─── Missing required fields checker (genérico para los 4 marketplaces) ──────

function MissingRequiredCheck({
  provider, fields, formData,
}: {
  provider: 'mercadolibre' | 'lider' | 'paris' | 'falabella'
  fields: any[]
  formData: Record<string, any>
}) {
  const [open, setOpen] = useState(false)

  const isEmpty = (v: any) => {
    if (v === undefined || v === null) return true
    if (typeof v === 'string') return v.trim() === ''
    if (Array.isArray(v)) return v.length === 0
    if (typeof v === 'object') return false   // ML attr objects, etc.
    return false
  }

  // Cargar atributos dinámicos según provider para detectar requeridos
  const mlCategoryId = formData.categoryId
  const fbCategoryId = formData.PrimaryCategory
  const parisFamilyId = formData.familyId

  const { data: mlAttrs } = useQuery<any>({
    queryKey: ['ml-cat-attrs', mlCategoryId],
    queryFn: () => api.get(`/publications/ml/categories/${mlCategoryId}/attributes`).then(r => r.data),
    enabled: provider === 'mercadolibre' && !!mlCategoryId && open,
  })

  const { data: fbAttrs } = useQuery<any>({
    queryKey: ['fb-cat-attrs', fbCategoryId],
    queryFn: () => api.get(`/publications/falabella/categories/${fbCategoryId}/attributes`).then(r => r.data),
    enabled: provider === 'falabella' && !!fbCategoryId && open,
  })

  const { data: parisProductAttrs } = useQuery<any>({
    queryKey: ['paris-attrs-product', parisFamilyId],
    queryFn: () => api.get(`/publications/paris/families/${parisFamilyId}/attributes?kind=product`).then(r => r.data),
    enabled: provider === 'paris' && !!parisFamilyId && open,
  })
  const { data: parisVariantAttrs } = useQuery<any>({
    queryKey: ['paris-attrs-variant', parisFamilyId],
    queryFn: () => api.get(`/publications/paris/families/${parisFamilyId}/attributes?kind=variant`).then(r => r.data),
    enabled: provider === 'paris' && !!parisFamilyId && open,
  })

  // Lista de {label, key, source} con los campos requeridos faltantes
  const missing: Array<{ label: string; key: string; group: string }> = []

  // 1) Campos del schema base (válido para los 4 providers)
  for (const f of fields || []) {
    if (!f.required) continue
    if (isEmpty(formData[f.key])) {
      missing.push({ label: f.label, key: f.key, group: 'Anclajes' })
    }
  }

  // 2) Atributos dinámicos según provider
  if (provider === 'mercadolibre' && mlAttrs) {
    const all = [...(mlAttrs.required || []), ...(mlAttrs.sellerPackage || [])]
    for (const a of all) {
      if (!a.required) continue
      const v = formData[`ml_attr_${a.id}`]
      if (isEmpty(v)) missing.push({ label: a.name, key: a.id, group: 'Atributos ML' })
    }
  }

  if (provider === 'falabella' && fbAttrs?.attributes) {
    const ANCHORS = new Set(['PrimaryCategory', 'SellerSku', 'images'])
    for (const a of fbAttrs.attributes) {
      if (!a.isMandatory) continue
      const key = ANCHORS.has(a.feedName) ? a.feedName : `fb_attr_${a.feedName}`
      if (isEmpty(formData[key])) missing.push({ label: a.label, key: a.feedName, group: 'Atributos Falabella' })
    }
  }

  if (provider === 'paris') {
    const productList = (parisProductAttrs?.results || parisProductAttrs || [])
    const variantList = (parisVariantAttrs?.results || parisVariantAttrs || [])
    for (const a of productList) {
      const req = a.familyAttributes?.[0]?.attributeValidation?.isRequired
      if (!req) continue
      const v = formData[`paris_pattr_${a.id}`]
      if (isEmpty(v)) missing.push({ label: a.name, key: a.id, group: 'Atributos producto Paris' })
    }
    for (const a of variantList) {
      const req = a.familyAttributes?.[0]?.attributeValidation?.isRequired
      if (!req) continue
      const v = formData[`paris_vattr_${a.id}`]
      if (isEmpty(v)) missing.push({ label: a.name, key: a.id, group: 'Atributos variante Paris' })
    }
  }

  // Lider: ya está cubierto por el schema base — los fields ya tienen `required: true`

  // Group by section
  const byGroup: Record<string, typeof missing> = {}
  for (const m of missing) {
    if (!byGroup[m.group]) byGroup[m.group] = []
    byGroup[m.group].push(m)
  }

  const total = missing.length

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-amber-100/40 transition-colors rounded-xl"
      >
        <div className="flex items-center gap-2">
          <AlertCircle className={`w-4 h-4 ${total > 0 ? 'text-amber-600' : 'text-green-600'}`} />
          <span className="text-sm font-medium text-amber-900">
            {total === 0
              ? 'Todos los campos obligatorios están completos'
              : `Faltan ${total} ${total === 1 ? 'campo obligatorio' : 'campos obligatorios'}`}
          </span>
        </div>
        <span className="text-xs text-amber-700">{open ? 'Ocultar' : 'Ver detalle'}</span>
      </button>
      {open && total > 0 && (
        <div className="px-4 pb-3 space-y-2">
          {Object.entries(byGroup).map(([groupName, items]) => (
            <div key={groupName}>
              <p className="text-xs font-semibold text-amber-800 uppercase tracking-wider mt-1 mb-1">{groupName}</p>
              <ul className="text-sm text-amber-900 space-y-0.5 list-disc pl-5">
                {items.map(m => (
                  <li key={m.group + ':' + m.key}>{m.label}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── AI Autofill button (genérico para los 4 marketplaces) ────────────────────

function AutofillButton({
  provider, productId, formData, setFormData,
}: {
  provider: 'mercadolibre' | 'lider' | 'paris' | 'falabella'
  productId?: string
  formData: Record<string, any>
  setFormData?: (fn: (prev: Record<string, any>) => Record<string, any>) => void
}) {
  const [loading, setLoading] = useState(false)
  const [meta, setMeta] = useState<any>(null)

  const isEmpty = (v: any) => v === undefined || v === null || v === ''

  // Cada marketplace tiene su propia gate (cuándo está habilitado el botón) y su mapping
  const gate = (() => {
    if (provider === 'mercadolibre') return !!formData.categoryId
    if (provider === 'lider')        return !!formData.productType
    if (provider === 'paris')        return !!formData.familyId
    if (provider === 'falabella')    return !!formData.PrimaryCategory
    return false
  })()

  const run = async () => {
    if (!productId || !setFormData || !gate) return
    setLoading(true)
    setMeta(null)
    try {
      let path = '', payload: any = { productId }, applyResult: (data: any) => void = () => {}

      if (provider === 'mercadolibre') {
        path = '/publications/ai/autofill-ml'
        payload.categoryId = formData.categoryId
        applyResult = (data) => {
          setFormData!(prev => {
            const next: Record<string, any> = { ...prev }
            if (data.title && isEmpty(next.title)) next.title = data.title
            if (data.description && isEmpty(next.description)) next.description = data.description
            for (const [attrId, val] of Object.entries(data.attributes || {})) {
              const key = `ml_attr_${attrId}`
              if (isEmpty(next[key])) next[key] = val
            }
            return next
          })
        }
      } else if (provider === 'lider') {
        path = '/publications/ai/autofill-lider'
        payload.productType = formData.productType
        applyResult = (data) => {
          setFormData!(prev => {
            const next: Record<string, any> = { ...prev }
            for (const [k, v] of Object.entries(data.fields || {})) {
              if (isEmpty(next[k])) next[k] = v
            }
            return next
          })
        }
      } else if (provider === 'paris') {
        path = '/publications/ai/autofill-paris'
        payload.familyId = formData.familyId
        if (formData.categoryId) payload.categoryId = formData.categoryId
        applyResult = (data) => {
          setFormData!(prev => {
            const next: Record<string, any> = { ...prev }
            if (data.name && isEmpty(next.name)) next.name = data.name
            if (data.sellerSku && isEmpty(next.sellerSku)) next.sellerSku = data.sellerSku
            for (const [id, v] of Object.entries(data.productAttributes || {})) {
              const key = `paris_pattr_${id}`
              if (isEmpty(next[key])) next[key] = v
            }
            for (const [id, v] of Object.entries(data.variantAttributes || {})) {
              const key = `paris_vattr_${id}`
              if (isEmpty(next[key])) next[key] = v
            }
            return next
          })
        }
      } else if (provider === 'falabella') {
        path = '/publications/ai/autofill-falabella'
        payload.categoryId = formData.PrimaryCategory
        applyResult = (data) => {
          setFormData!(prev => {
            const next: Record<string, any> = { ...prev }
            // Falabella attributes are stored under fb_attr_<feedName> in formData,
            // EXCEPT a few "anchor" fields (PrimaryCategory, SellerSku, images) which use the bare key.
            const ANCHORS = new Set(['PrimaryCategory', 'SellerSku', 'images'])
            for (const [feedName, v] of Object.entries(data.attributes || {})) {
              const key = ANCHORS.has(feedName) ? feedName : `fb_attr_${feedName}`
              if (isEmpty(next[key])) next[key] = v
            }
            return next
          })
        }
      }

      const r = await api.post(path, payload)
      applyResult(r.data)
      setMeta(r.data?.meta)

      // Build a friendly message describing what was filled
      const m = r.data?.meta || {}
      const filled =
        m.attrsFilled ??
        m.fieldsFilled ??
        ((m.productAttrsFilled ?? 0) + (m.variantAttrsFilled ?? 0))
      const total =
        m.attrsTotal ??
        m.fieldsTotal ??
        ((m.productAttrsTotal ?? 0) + (m.variantAttrsTotal ?? 0))
      if (filled === 0) {
        toast.warning(`La IA no pudo completar campos (0/${total}). Revisa que la categoría sea correcta.`)
      } else {
        toast.success(`Auto-completado: ${filled}/${total} campos (campos editados se respetaron)`)
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || 'Error al auto-completar')
    } finally {
      setLoading(false)
    }
  }

  if (!productId) return null

  const gateHint = (() => {
    if (provider === 'mercadolibre') return 'Selecciona primero una categoría ML'
    if (provider === 'lider')        return 'Selecciona primero una categoría Lider'
    if (provider === 'paris')        return 'Selecciona primero una familia Paris'
    if (provider === 'falabella')    return 'Selecciona primero una categoría Falabella'
    return ''
  })()

  return (
    <div className="bg-gradient-to-r from-violet-50 to-sky-50 border border-violet-200 rounded-xl p-3 flex items-center justify-between gap-3">
      <div className="flex-1">
        <p className="text-sm font-medium text-violet-900">✨ Auto-completar con IA</p>
        <p className="text-xs text-violet-700 mt-0.5">
          {gate
            ? 'Rellena los campos usando los datos del catálogo maestro. Respeta los campos que ya editaste.'
            : gateHint}
        </p>
        {meta && (
          <p className="text-[11px] text-violet-600 mt-1 font-mono">
            in {meta.inputTokens} / out {meta.outputTokens} tokens · {meta.model}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={run}
        disabled={loading || !gate}
        className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40 inline-flex items-center gap-2 whitespace-nowrap"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : '✨'}
        {loading ? 'Generando…' : 'Auto-completar'}
      </button>
    </div>
  )
}

function FormFields({
  fields, formData, setValue, provider, setFormData, productId,
}: {
  fields: any[]
  formData: Record<string, any>
  setValue: (k: string, v: any) => void
  provider?: string
  setFormData?: (fn: (prev: Record<string, any>) => Record<string, any>) => void
  productId?: string
}) {
  const groups: Record<string, any[]> = {}
  for (const field of fields) {
    const g = field.group || 'General'
    if (!groups[g]) groups[g] = []
    groups[g].push(field)
  }

  return (
    <div className="space-y-6">
      {Object.entries(groups).map(([groupName, groupFields]) => (
        <div key={groupName}>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{groupName}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {groupFields.map((field: any) => {
              const isWide = field.type === 'textarea' || field.type === 'images'
                || (field.key === 'categoryId' && provider === 'mercadolibre')
                || (field.key === 'PrimaryCategory' && provider === 'falabella')
                || ((field.key === 'familyId' || field.key === 'categoryId') && provider === 'paris')
              return (
                <div key={field.key} className={isWide ? 'md:col-span-2' : ''}>
                  <label className="text-sm font-medium text-gray-700">
                    {field.label} {field.required && <span className="text-red-500">*</span>}
                  </label>
                  {field.hint && field.type !== 'images' && field.key !== 'categoryId' && field.key !== 'PrimaryCategory' && (
                    <p className="text-xs text-gray-400 mt-0.5">{field.hint}</p>
                  )}
                  <FieldRenderer
                    field={field}
                    value={formData[field.key]}
                    onChange={v => setValue(field.key, v)}
                    provider={provider}
                    formData={formData}
                    setFormData={setFormData}
                  />
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {/* Botón de auto-completar con IA (ML / Lider / Paris / Falabella) */}
      {(provider === 'mercadolibre' || provider === 'lider' || provider === 'paris' || provider === 'falabella') && (
        <AutofillButton
          provider={provider as any}
          productId={productId}
          formData={formData}
          setFormData={setFormData}
        />
      )}

      {/* Validación de campos obligatorios — visible cuando hay categoría/familia seleccionada */}
      {(provider === 'mercadolibre' || provider === 'lider' || provider === 'paris' || provider === 'falabella') &&
        (
          (provider === 'mercadolibre' && formData.categoryId) ||
          (provider === 'falabella'    && formData.PrimaryCategory) ||
          (provider === 'paris'        && formData.familyId) ||
          (provider === 'lider'        && formData.productType)
        ) && (
          <MissingRequiredCheck
            provider={provider as any}
            fields={fields}
            formData={formData}
          />
        )}

      {/* ML: atributos dinámicos según categoría */}
      {provider === 'mercadolibre' && formData.categoryId && (
        <MLAttributeFields
          categoryId={formData.categoryId}
          formData={formData}
          setValue={setValue}
        />
      )}

      {/* Falabella: atributos dinámicos según categoría */}
      {provider === 'falabella' && formData.PrimaryCategory && (
        <FalabellaAttributeFields
          categoryId={formData.PrimaryCategory}
          formData={formData}
          setValue={setValue}
        />
      )}

      {/* Paris: atributos dinámicos por familia + editor de precios */}
      {provider === 'paris' && formData.familyId && (
        <>
          <ParisAttributeFields
            familyId={formData.familyId}
            formData={formData}
            setValue={setValue}
          />
          <ParisPricesEditor formData={formData} setValue={setValue} />
        </>
      )}
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

// useSearchParams() en Next 14 con SSG requiere estar dentro de <Suspense>.
// Como esta página es client-side completa (use client) y necesita los
// query params para deep-linking desde otras vistas, envolvemos el cuerpo
// en Suspense para satisfacer el prerender estático.
export default function PublicationsPage() {
  return (
    <Suspense fallback={null}>
      <PublicationsPageInner />
    </Suspense>
  )
}

function PublicationsPageInner() {
  const searchParams = useSearchParams()
  const deepLinkProductId = searchParams.get('productId')
  const deepLinkConnectionId = searchParams.get('connectionId')

  const [mode, setMode] = useState<Mode>('from-catalog')
  const [selectedProduct, setSelectedProduct] = useState<any>(null)
  const [selectedConnection, setSelectedConnection] = useState<any>(null)
  const [showForm, setShowForm] = useState(false)
  const [showDetail, setShowDetail] = useState<any>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [linkFilter, setLinkFilter] = useState('') // '', '<connectionId>' = vinculado a ese market
  const [page, setPage] = useState(1)
  const [deepLinkApplied, setDeepLinkApplied] = useState(false)
  const PAGE_SIZE = 30

  // Debounce de la búsqueda — 400ms tras dejar de tipear
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(() => { setDebouncedSearch(search); setPage(1) }, 400)
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current) }
  }, [search])

  const { data: productsData, isLoading: loadingProducts } = useQuery<any>({
    queryKey: ['products-pub', debouncedSearch, statusFilter, linkFilter, page],
    queryFn: () =>
      api.get('/products', {
        params: {
          page,
          limit: PAGE_SIZE,
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(linkFilter ? { connectionId: linkFilter } : {}),
        },
      }).then(r => r.data),
    placeholderData: (prev: any) => prev,
  })

  const { data: connections = [] } = useQuery<any[]>({
    queryKey: ['connections-marketplace'],
    queryFn: () => api.get('/connections').then(r =>
      r.data.filter((c: any) => c.type === 'marketplace' && c.status === 'connected')
    ),
  })

  const { data: publications = [], refetch: refetchPubs } = useQuery<any[]>({
    queryKey: ['publications', selectedProduct?.id],
    queryFn: () => api.get(`/publications/product/${selectedProduct.id}`).then(r => r.data),
    enabled: !!selectedProduct,
  })

  const products = productsData?.data || []

  // Deep-link from /products/master: pre-select product + connection and open form.
  useEffect(() => {
    if (deepLinkApplied) return
    if (!deepLinkProductId || !deepLinkConnectionId) return
    if (!products.length || !connections.length) return

    const product = products.find((p: any) => p.id === deepLinkProductId)
    const connection = connections.find((c: any) => c.id === deepLinkConnectionId)
    if (!product || !connection) {
      setDeepLinkApplied(true)
      return
    }
    setMode('from-catalog')
    setSelectedProduct(product)
    setSelectedConnection(connection)
    setShowForm(true)
    setDeepLinkApplied(true)
  }, [deepLinkProductId, deepLinkConnectionId, products, connections, deepLinkApplied])

  return (
    <div className="px-7 py-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p
            className="sc-mono uppercase"
            style={{
              fontSize: 11,
              letterSpacing: '0.14em',
              color: 'var(--sc-text-low)',
              marginBottom: 6,
            }}
          >
            CONSOLA <span style={{ margin: '0 8px', color: 'var(--sc-text-faint)' }}>/</span>
            <span style={{ color: 'var(--sc-blue-600)' }}>PUBLICACIONES</span>
          </p>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 600,
              color: 'var(--sc-text-hi)',
              letterSpacing: '-0.01em',
              margin: 0,
            }}
          >
            Publicaciones por canal
          </h1>
          <p style={{ fontSize: 13, color: 'var(--sc-text-mid)', margin: '4px 0 0' }}>
            Publica productos en tus marketplaces
          </p>
        </div>
      </div>

      {/* Selector de modo */}
      <div className="flex gap-3">
        <button
          onClick={() => { setMode('from-catalog'); setSelectedProduct(null); setShowForm(false) }}
          className={cn(
            'flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-medium border-2 transition-all',
            mode === 'from-catalog'
              ? 'border-sky-500 bg-sky-50 text-sky-700'
              : 'border-gray-200 text-gray-600 hover:border-gray-300'
          )}
        >
          <Package className="w-4 h-4" />
          Desde catálogo maestro
        </button>
        <button
          onClick={() => { setMode('direct'); setSelectedProduct(null); setShowForm(false) }}
          className={cn(
            'flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-medium border-2 transition-all',
            mode === 'direct'
              ? 'border-sky-500 bg-sky-50 text-sky-700'
              : 'border-gray-200 text-gray-600 hover:border-gray-300'
          )}
        >
          <Plus className="w-4 h-4" />
          Publicación directa en marketplace
        </button>
      </div>

      {/* MODO: Publicación directa */}
      {mode === 'direct' && (
        <DirectPublishPanel connections={connections} />
      )}

      {/* MODO: Desde catálogo maestro */}
      {mode === 'from-catalog' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Panel izquierdo — lista de productos */}
          <div className="bg-white border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b bg-gray-50 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-700">Catálogo maestro</p>
                {productsData?.meta && (
                  <span className="text-xs text-gray-400">{productsData.meta.total} productos</span>
                )}
              </div>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por nombre, SKU, marca..."
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <div className="flex gap-2">
                <select
                  value={statusFilter}
                  onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
                  className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="">Todos los estados</option>
                  <option value="active">Activo</option>
                  <option value="out_of_stock">Agotado</option>
                  <option value="coming_soon">Próximamente</option>
                  <option value="unavailable">No disponible</option>
                </select>
                <select
                  value={linkFilter}
                  onChange={e => { setLinkFilter(e.target.value); setPage(1) }}
                  className="flex-1 px-2 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="">Todos (vínculo)</option>
                  {connections.map((c: any) => (
                    <option key={c.id} value={c.id}>Vinculado a {PROVIDER_LABELS[c.provider] || c.provider}</option>
                  ))}
                </select>
              </div>
            </div>
            {loadingProducts ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-6 h-6 animate-spin text-sky-500" />
              </div>
            ) : products.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Package className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-400">No hay productos que coincidan</p>
              </div>
            ) : (
              <div className="divide-y max-h-[600px] overflow-y-auto">
                {products.map((p: any) => {
                  const totalStock = p.inventory?.reduce((s: number, i: any) => s + i.quantity, 0) || 0
                  // Resolver providers vinculados a este producto cruzando los
                  // mappings que ya vienen con connectionId. Excluimos catalog
                  // sources (EYLSTORE) porque NO son destinos de venta —
                  // distorsionan el conteo y los logos visibles.
                  const linkedProviders: string[] = (p.marketplaceMappings || [])
                    .map((m: any) => {
                      const conn = (connections || []).find((c: any) => c.id === m.connectionId)
                      return conn?.provider
                    })
                    .filter((prov: string | undefined): prov is string => !!prov)
                  const thumb = Array.isArray(p.images) && p.images.length > 0 ? p.images[0] : null
                  return (
                    <button key={p.id} onClick={() => { setSelectedProduct(p); setShowForm(false) }}
                      className={cn(
                        'w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex gap-3',
                        selectedProduct?.id === p.id && 'bg-sky-50 border-r-2 border-sky-500'
                      )}>
                      <div className="w-12 h-12 flex-shrink-0 rounded-lg bg-gray-50 border border-gray-100 overflow-hidden flex items-center justify-center">
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumb} alt={p.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                        ) : (
                          <Package className="w-5 h-5 text-gray-300" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                        <div className="flex items-center justify-between mt-0.5">
                          <p className="text-xs text-gray-400 font-mono">{p.sku}</p>
                          <p className="text-xs text-gray-500">{formatCurrency(Number(p.basePrice))}</p>
                        </div>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-xs text-gray-400">Stock: {totalStock}</span>
                          {linkedProviders.length > 0 && (
                            <div className="flex items-center gap-1" title={`Publicado en: ${linkedProviders.map((p) => PROVIDER_LABELS[p] || p).join(', ')}`}>
                              {linkedProviders.map((prov) => (
                                <ProviderLogo key={prov} provider={prov} size="sm" className="w-5 h-5 rounded-full ring-1 ring-white" />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
            {/* Paginación */}
            {productsData?.meta && productsData.meta.total > PAGE_SIZE && (
              <div className="px-4 py-3 border-t bg-gray-50 flex items-center justify-between">
                <span className="text-xs text-gray-500">
                  Pág {page} de {Math.ceil(productsData.meta.total / PAGE_SIZE)}
                </span>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setPage((x) => Math.max(1, x - 1))}
                    disabled={page === 1}
                    className="px-2.5 py-1 text-xs border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-white"
                  >
                    Anterior
                  </button>
                  <button
                    onClick={() => setPage((x) => x + 1)}
                    disabled={page >= Math.ceil(productsData.meta.total / PAGE_SIZE)}
                    className="px-2.5 py-1 text-xs border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-white"
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Panel derecho */}
          <div className="lg:col-span-2 space-y-4">
            {!selectedProduct ? (
              <div className="bg-white border rounded-xl flex flex-col items-center justify-center py-24 gap-3">
                <ArrowRight className="w-8 h-8 text-gray-300" />
                <p className="text-gray-400 text-sm">Selecciona un producto para gestionar sus publicaciones</p>
              </div>
            ) : (
              <>
                {/* Cabecera producto */}
                <div className="bg-white border rounded-xl p-5">
                  <div className="flex items-start gap-4">
                    {(() => {
                      const imgs = Array.isArray(selectedProduct.images) ? selectedProduct.images : []
                      const main = imgs[0]
                      return (
                        <div className="w-24 h-24 flex-shrink-0 rounded-xl bg-gray-50 border border-gray-100 overflow-hidden flex items-center justify-center">
                          {main ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={main} alt={selectedProduct.name} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                          ) : (
                            <Package className="w-8 h-8 text-gray-300" />
                          )}
                        </div>
                      )
                    })()}
                    <div className="flex-1 min-w-0">
                      <h2 className="font-bold text-gray-900">{selectedProduct.name}</h2>
                      <div className="flex items-center gap-3 mt-1">
                        <p className="text-sm text-gray-500 font-mono">SKU: {selectedProduct.sku}</p>
                        {selectedProduct.brand && (
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{selectedProduct.brand}</span>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-gray-900 mt-1">{formatCurrency(Number(selectedProduct.basePrice))}</p>
                      {Array.isArray(selectedProduct.images) && selectedProduct.images.length > 1 && (
                        <div className="flex items-center gap-1.5 mt-2">
                          {selectedProduct.images.slice(1, 6).map((url: string, i: number) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={i} src={url} alt="" className="w-10 h-10 rounded-md object-cover border border-gray-100" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                          ))}
                          {selectedProduct.images.length > 6 && (
                            <span className="text-xs text-gray-400 ml-1">+{selectedProduct.images.length - 6}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Estado por marketplace */}
                <div className="bg-white border rounded-xl overflow-hidden">
                  <div className="px-5 py-3 border-b bg-gray-50">
                    <p className="text-sm font-semibold text-gray-700">Estado por marketplace</p>
                  </div>
                  {connections.length === 0 ? (
                    <p className="px-5 py-8 text-sm text-gray-400 text-center">
                      No hay marketplaces conectados. Ve a <strong>Conexiones</strong> para agregar uno.
                    </p>
                  ) : (
                    <div className="divide-y">
                      {connections.map((conn: any) => {
                        const pub = publications.find((p: any) => p.connectionId === conn.id)
                        const status = pub?.syncStatus || 'unlinked'
                        const info = SYNC_STATUS_INFO[status] || SYNC_STATUS_INFO.unlinked
                        const Icon = info.icon
                        const isLinked = LINKED_STATUSES.has(status)
                        return (
                          <div key={conn.id} className="px-5 py-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <ProviderLogo provider={conn.provider} size="sm" className="w-9 h-9" />
                                <div>
                                  <p className="text-sm font-medium text-gray-900">{conn.name}</p>
                                  <p className="text-xs text-gray-400">{PROVIDER_LABELS[conn.provider] || conn.provider}</p>
                                  {pub?.marketplaceSku && (
                                    <p className="text-xs text-gray-400 font-mono">SKU: {pub.marketplaceSku}</p>
                                  )}
                                  {pub?.marketplaceProductId && isLinked && (
                                    <p className="text-xs text-gray-400 font-mono">ID: {pub.marketplaceProductId}</p>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className={cn('flex items-center gap-1.5 text-xs font-medium', info.color)}>
                                  <Icon className="w-4 h-4" /> {info.label}
                                </div>
                                {pub?.formData && (
                                  <button
                                    onClick={() => setShowDetail(showDetail?.id === pub.id ? null : pub)}
                                    className="px-3 py-1.5 border border-gray-200 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-50">
                                    {showDetail?.id === pub.id ? 'Ocultar' : 'Ver detalle'}
                                  </button>
                                )}
                                {/* Si el producto YA está vinculado, no permitimos "Publicar" otra vez
                                    (evita duplicados accidentales en ML). Para cambiar precio/stock se
                                    usa el sync automático del cron y la calculadora; para editar campos
                                    de la publicación, "Actualizar" abre el form. */}
                                <button
                                  onClick={() => { setSelectedConnection(conn); setShowDetail(null); setShowForm(true) }}
                                  className={cn(
                                    'px-3 py-1.5 rounded-lg text-xs font-medium',
                                    isLinked
                                      ? 'border border-gray-200 text-gray-700 hover:bg-gray-50'
                                      : 'bg-sky-600 text-white hover:bg-sky-700',
                                  )}>
                                  {isLinked ? 'Actualizar' : 'Publicar'}
                                </button>
                              </div>
                            </div>
                            {showDetail?.id === pub?.id && pub?.formData && (
                              <PublicationDetail pub={pub} />
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* Formulario dinámico */}
                {showForm && selectedConnection && (
                  <PublishForm
                    product={selectedProduct}
                    connection={selectedConnection}
                    onClose={() => setShowForm(false)}
                    onSuccess={() => { refetchPubs(); setShowForm(false) }}
                  />
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Detalle de publicación ──────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  productName: 'Nombre del producto', brand: 'Marca', price: 'Precio (CLP)',
  availableQuantity: 'Stock', productIdType: 'Tipo de ID', productId: 'ID del producto',
  sku: 'SKU', shippingWeightValue: 'Peso de envío', shippingWeightUnit: 'Unidad de peso',
  productType: 'Categoría', shortDescription: 'Descripción', warrantyText: 'Garantía',
  color: 'Color', manufacturer: 'Fabricante', fulfillmentLagTime: 'Días de preparación',
  storageCapacity: 'Almacenamiento', operatingSystem: 'Sistema operativo',
  images: 'Imágenes',
}

function PublicationDetail({ pub }: { pub: any }) {
  const fd = pub.formData as Record<string, any>
  const images: string[] = Array.isArray(fd.images) ? fd.images.filter(Boolean) : []

  const skip = new Set(['images'])
  const entries = Object.entries(fd).filter(([k, v]) =>
    !skip.has(k) && v !== undefined && v !== null && v !== ''
  )

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      {images.length > 0 && (
        <div className="flex gap-2 mb-3 flex-wrap">
          {images.map((url, i) => (
            <div key={i} className="w-16 h-16 rounded-lg border border-gray-200 overflow-hidden bg-gray-50 flex-shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
        {entries.map(([key, val]) => (
          <div key={key} className="flex flex-col">
            <span className="text-xs text-gray-400">{FIELD_LABELS[key] || key}</span>
            <span className="text-xs font-medium text-gray-700 truncate">
              {key === 'price' ? formatCurrency(Number(val)) : String(val)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-4 text-xs text-gray-400">
        <span>Última sync: {new Date(pub.lastSyncAt).toLocaleString('es-CL')}</span>
        {pub.marketplacePrice && <span>Precio publicado: {formatCurrency(Number(pub.marketplacePrice))}</span>}
      </div>
    </div>
  )
}

// ─── Publicación directa ─────────────────────────────────────────────────────

function DirectPublishPanel({ connections }: { connections: any[] }) {
  const qc = useQueryClient()
  const [selectedConnection, setSelectedConnection] = useState<any>(connections[0] || null)
  const [formData, setFormData] = useState<Record<string, any>>({})
  const [createInCatalog, setCreateInCatalog] = useState(true)
  const [selectedProductType, setSelectedProductType] = useState<string>('')
  const [mlMode, setMlMode] = useState<'catalog' | 'custom'>('catalog')
  const isLider = selectedConnection?.provider === 'lider'

  const { data: productTypes } = useQuery<{ id: string; label: string }[]>({
    queryKey: ['lider-product-types'],
    queryFn: () => api.get('/publications/lider/product-types').then(r => r.data),
    enabled: isLider,
  })

  const { data: liderSchema, isLoading: loadingLiderSchema } = useQuery<any>({
    queryKey: ['lider-form', selectedProductType],
    queryFn: () => api.get(`/publications/lider/form/${encodeURIComponent(selectedProductType)}`).then(r => r.data),
    enabled: isLider && !!selectedProductType,
  })

  const { data: staticSchema } = useQuery<any>({
    queryKey: ['pub-form', selectedConnection?.provider],
    queryFn: () => api.get(`/publications/forms/${selectedConnection.provider}`).then(r => r.data),
    enabled: !!selectedConnection && !isLider,
  })

  const schema = isLider ? liderSchema : staticSchema
  const isML = selectedConnection?.provider === 'mercadolibre'

  // Sugerencia del próximo SKU correlativo del maestro. Cuando publicás
  // directamente (sin elegir producto del maestro), precargamos el SKU
  // con el siguiente correlativo (ej. 1977 → 1978) para que el operador
  // no tenga que adivinar. Se carga una vez al montar.
  const { data: nextSkuData } = useQuery<{ sku: string }>({
    queryKey: ['next-sku'],
    queryFn: () => api.get('/products/next-sku').then(r => r.data),
    staleTime: 60 * 1000,
  })

  // Aplicar defaults del schema cuando llega/cambia el provider. Solo setea
  // keys ausentes/vacías. Ej: warranty="6 meses" en ML. También precarga
  // el SKU sugerido si el field lo requiere y el usuario no lo tipeó.
  useEffect(() => {
    if (!schema?.fields?.length) return
    setFormData((prev) => {
      const next = { ...prev }
      let changed = false
      for (const f of schema.fields) {
        if (f.default !== undefined && (next[f.key] === undefined || next[f.key] === '')) {
          next[f.key] = f.default
          changed = true
        }
      }
      // Auto-sugerir SKU si el schema lo pide y aún no se llenó
      if (
        schema.fields.some((f: any) => f.key === 'sku') &&
        (next.sku === undefined || next.sku === '') &&
        nextSkuData?.sku
      ) {
        next.sku = nextSkuData.sku
        changed = true
      }
      return changed ? next : prev
    })
  }, [schema, nextSkuData])

  const buildPayload = (fd: Record<string, any>, extra?: Record<string, any>) => {
    const imageUrls = Array.isArray(fd.images) ? fd.images.filter(Boolean) : []
    // Extract ml_attr_* keys into attributes array for ML.
    // Each entry already has { id, value_id?, value_name?, value_struct? }
    const attributes = Object.entries(fd)
      .filter(([k, v]) => k.startsWith('ml_attr_') && v && (v as any).id)
      .map(([, v]) => v)
    // Falabella: fb_attr_FeedName -> top-level formData[FeedName]
    const fbExtras = Object.entries(fd)
      .filter(([k, v]) => k.startsWith('fb_attr_') && v !== undefined && v !== null && v !== '')
      .reduce<Record<string, any>>((acc, [k, v]) => { acc[k.replace('fb_attr_', '')] = v; return acc }, {})
    const cleanFd = Object.fromEntries(
      Object.entries(fd).filter(([k]) => !k.startsWith('ml_attr_') && !k.startsWith('fb_attr_'))
    )
    const mergedFd = { ...cleanFd, ...fbExtras, ...extra, ...(attributes.length ? { attributes } : {}) }
    return { formData: mergedFd, imageUrls }
  }

  // For "Validar antes de publicar" — builds the same payload ML /items/validate expects
  const buildMLValidatePayload = () => {
    const fd = { ...formData }
    const attributes = Object.entries(fd)
      .filter(([k, v]) => k.startsWith('ml_attr_') && v && (v as any).id)
      .map(([, v]) => v)
    const imageUrls = Array.isArray(fd.images) ? fd.images.filter(Boolean) : []
    const payload: Record<string, any> = {
      category_id: fd.categoryId,
      price: Number(fd.price ?? 0),
      currency_id: 'CLP',
      available_quantity: Number(fd.availableQuantity ?? 1),
      buying_mode: 'buy_it_now',
      listing_type_id: fd.listingTypeId || fd.listing_type_id || 'gold_special',
      condition: fd.condition || 'new',
      pictures: imageUrls.map((u: string) => ({ source: u })),
      attributes,
    }
    if (fd.catalog_product_id) payload.catalog_product_id = fd.catalog_product_id
    if (fd.family_name) payload.family_name = fd.family_name
    if (fd.title && !fd.catalog_product_id) payload.title = fd.title
    return payload
  }

  const publishMutation = useMutation({
    mutationFn: async () => {
      const productRes = await api.post('/products', {
        sku: formData.sku || formData.sellerSku || undefined,
        name: formData.productName || formData.title || formData.name || formData.family_name || 'Producto',
        brand: formData.brand || undefined,
        basePrice: Number(formData.price || 0),
        status: 'active',
      })
      const product = productRes.data
      const payload = isLider
        ? buildPayload(formData, { productType: selectedProductType })
        : buildPayload(formData)
      return api.post(`/publications/product/${product.id}/connection/${selectedConnection.id}`, payload)
    },
    onSuccess: () => {
      toast.success('Producto publicado en el marketplace correctamente')
      qc.invalidateQueries({ queryKey: ['products-pub'] })
      setFormData({})
      setSelectedProductType('')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error al publicar'),
  })

  const setValue = (key: string, value: any) => setFormData(f => ({ ...f, [key]: value }))

  if (connections.length === 0) {
    return (
      <div className="bg-white border rounded-xl flex items-center justify-center py-20">
        <p className="text-gray-400 text-sm">No hay marketplaces conectados. Ve a <strong>Conexiones</strong> para agregar uno.</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Selector de marketplace */}
      <div className="bg-white border rounded-xl overflow-hidden self-start">
        <div className="px-4 py-3 border-b bg-gray-50">
          <p className="text-sm font-semibold text-gray-700">Marketplace destino</p>
        </div>
        <div className="divide-y">
          {connections.map((conn: any) => (
            <button key={conn.id} onClick={() => { setSelectedConnection(conn); setFormData({}) }}
              className={cn(
                'w-full text-left px-4 py-4 hover:bg-gray-50 transition-colors',
                selectedConnection?.id === conn.id && 'bg-sky-50 border-r-2 border-sky-500'
              )}>
              <div className="flex items-center gap-3">
                <ProviderLogo provider={conn.provider} size="sm" className="w-9 h-9" />
                <div>
                  <p className="text-sm font-medium text-gray-900">{conn.name}</p>
                  <p className="text-xs text-gray-400">{PROVIDER_LABELS[conn.provider] || conn.provider}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Formulario */}
      <div className="lg:col-span-2">
        {!selectedConnection ? (
          <div className="bg-white border rounded-xl flex items-center justify-center py-24">
            <p className="text-gray-400 text-sm">Selecciona un marketplace</p>
          </div>
        ) : !schema && !(isLider && !selectedProductType) ? (
          <div className="bg-white border rounded-xl flex items-center justify-center py-24">
            <Loader2 className="w-6 h-6 animate-spin text-sky-500" />
          </div>
        ) : (
          <div className="bg-white border rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b bg-gray-50">
              <p className="text-sm font-semibold text-gray-700">
                Nuevo producto en {PROVIDER_LABELS[selectedConnection.provider] || selectedConnection.provider}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">Completa los campos requeridos para publicar directamente</p>
            </div>

            <div className="p-5 space-y-6">
              {/* Opción catálogo */}
              <div className="flex items-center gap-3 p-3 bg-sky-50 border border-sky-100 rounded-xl">
                <input type="checkbox" id="create-catalog" checked={createInCatalog}
                  onChange={e => setCreateInCatalog(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500" />
                <label htmlFor="create-catalog" className="text-sm text-sky-800 cursor-pointer">
                  Agregar también al catálogo maestro de StockCentral
                </label>
              </div>

              {/* ML: selector de modo (catálogo vs custom) */}
              {isML && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setMlMode('catalog')}
                      className={cn(
                        'flex-1 px-3 py-2 rounded-xl text-sm font-medium border-2 transition-all',
                        mlMode === 'catalog' ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-gray-200 text-gray-600',
                      )}
                    >
                      Producto del catálogo ML
                    </button>
                    <button
                      type="button"
                      onClick={() => setMlMode('custom')}
                      className={cn(
                        'flex-1 px-3 py-2 rounded-xl text-sm font-medium border-2 transition-all',
                        mlMode === 'custom' ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-gray-200 text-gray-600',
                      )}
                    >
                      Producto custom (sin catálogo)
                    </button>
                  </div>

                  {mlMode === 'catalog' && (
                    <div className="p-3 border border-gray-200 rounded-xl">
                      <p className="text-xs text-gray-500 mb-2">
                        Busca el producto en el catálogo ML. Se autocompletan family_name, imágenes y atributos.
                      </p>
                      <MLCatalogSearch
                        categoryId={formData.categoryId}
                        onSelect={(p) => {
                          setFormData(f => {
                            const next: Record<string, any> = {
                              ...f,
                              catalog_product_id: p.id,
                              family_name: p.family_name || p.name,
                              categoryId: p.category_id || f.categoryId,
                              images: (Array.isArray(f.images) && f.images.length > 0) ? f.images : (p.pictures || []),
                            }
                            // Map catalog attributes into ml_attr_* keys
                            for (const a of (p.attributes || [])) {
                              if (!a?.id) continue
                              next[`ml_attr_${a.id}`] = {
                                id: a.id,
                                value_id: a.value_id,
                                value_name: a.value_name,
                                value_struct: a.value_struct,
                              }
                            }
                            return next
                          })
                          toast.success(`Catálogo ML: ${p.name}`)
                        }}
                      />
                      {formData.catalog_product_id && (
                        <div className="mt-2 px-3 py-2 bg-sky-50 border border-sky-200 rounded-lg text-xs flex items-center justify-between">
                          <span><span className="font-mono text-sky-700">{formData.catalog_product_id}</span> — {formData.family_name}</span>
                          <button
                            type="button"
                            onClick={() => setFormData(f => ({ ...f, catalog_product_id: undefined, family_name: undefined }))}
                            className="text-gray-400 hover:text-red-500"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {mlMode === 'custom' && (
                    <div className="p-3 border border-amber-200 bg-amber-50 rounded-xl text-xs text-amber-800">
                      <p className="font-medium mb-1">⚠ Cuenta brand/large_seller</p>
                      <p>Tu cuenta no acepta títulos custom. ML genera el título a partir de <code className="bg-amber-100 px-1 rounded">family_name</code> + atributos. Define un <code className="bg-amber-100 px-1 rounded">family_name</code> claro abajo.</p>
                    </div>
                  )}
                </div>
              )}

              {/* Lider: selector de categoría */}
              {isLider && (
                <div>
                  <label className="text-sm font-medium text-gray-700">
                    Categoría Walmart (Item Spec 4.3) <span className="text-red-500">*</span>
                  </label>
                  <p className="text-xs text-gray-400 mt-0.5">Los campos se generan desde el spec real de Walmart Chile</p>
                  <select
                    value={selectedProductType}
                    onChange={e => { setSelectedProductType(e.target.value); setFormData({}) }}
                    className="mt-2 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <option value="">Seleccionar categoría...</option>
                    {productTypes?.map(pt => (
                      <option key={pt.id} value={pt.id}>{LIDER_CATEGORY_LABELS[pt.label] || pt.label}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Loading lider spec */}
              {isLider && selectedProductType && loadingLiderSchema && (
                <div className="flex items-center gap-2 py-4">
                  <Loader2 className="w-4 h-4 animate-spin text-sky-500" />
                  <span className="text-sm text-gray-500">Cargando campos desde Item Spec de Walmart...</span>
                </div>
              )}

              {/* Formulario */}
              {(!isLider || (selectedProductType && schema)) && (
                <FormFields
                  fields={schema?.fields ?? []}
                  formData={formData}
                  setValue={setValue}
                  provider={selectedConnection?.provider}
                  setFormData={setFormData}
                />
              )}

              {isLider && !selectedProductType && (
                <p className="text-center text-sm text-gray-400 py-4">Selecciona una categoría para ver los campos</p>
              )}

              {/* ML: Validar antes de publicar */}
              {isML && formData.categoryId && (
                <MLValidateButton buildPayload={buildMLValidatePayload} />
              )}

              <div className="flex gap-3 pt-2 border-t">
                <button onClick={() => setFormData({})}
                  className="px-4 py-2 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50">
                  Limpiar
                </button>
                <button
                  onClick={() => publishMutation.mutate()}
                  disabled={publishMutation.isPending || (isLider && !selectedProductType)}
                  className="flex-1 px-4 py-2.5 bg-sky-600 text-white rounded-xl text-sm font-medium hover:bg-sky-700 disabled:opacity-50 flex items-center justify-center gap-2">
                  {publishMutation.isPending
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Publicando...</>
                    : <><Send className="w-4 h-4" /> Publicar en {PROVIDER_LABELS[selectedConnection.provider] || selectedConnection.provider}</>
                  }
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Formulario desde catálogo ───────────────────────────────────────────────

function PublishForm({ product, connection, onClose, onSuccess }: any) {
  const isLider = connection.provider === 'lider'
  const isML = connection.provider === 'mercadolibre'
  const totalStock = product.inventory?.reduce((s: number, i: any) => s + i.quantity, 0) || 0
  const [selectedProductType, setSelectedProductType] = useState<string>('')
  const [mlMode, setMlMode] = useState<'catalog' | 'custom'>('catalog')

  // Calculadora de precios por marketplace (configurada en el catálogo maestro).
  // Si está, se usa como precio sugerido; si no, fallback a salePrice/basePrice.
  const calculatedPrice = product?.marketplacePricing?.[connection.provider]?.calculatedPrice
  const initialPrice = Number(calculatedPrice ?? product.salePrice ?? product.basePrice)

  // Helpers: title corto para ML family_name (máx 60), descripción plain text
  // para ML (no acepta HTML rico, mejor sin tags).
  const stripHtml = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
  const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s)
  const familyNameFromMaster = truncate(product.name || '', 60)
  const descriptionPlain = stripHtml(product.description || '')

  const [formData, setFormData] = useState<Record<string, any>>({
    productName: product.name,
    name: product.name,
    title: product.name,
    family_name: familyNameFromMaster,  // ML usa este como base del título auto-generado
    price: initialPrice,
    PriceFalabella: initialPrice,
    QuantityFalabella: totalStock,
    sku: product.sku,
    sellerSku: product.sku,
    brand: product.brand || '',
    shortDescription: descriptionPlain,
    description: descriptionPlain,
    availableQuantity: totalStock,
    images: Array.isArray(product.images) ? product.images : [],
  })

  // For Lider: load product types list
  const { data: productTypes } = useQuery<{ id: string; label: string }[]>({
    queryKey: ['lider-product-types'],
    queryFn: () => api.get('/publications/lider/product-types').then(r => r.data),
    enabled: isLider,
  })

  // For Lider: load spec fields for selected product type
  const { data: liderSchema, isLoading: loadingLiderSchema } = useQuery<any>({
    queryKey: ['lider-form', selectedProductType],
    queryFn: () => api.get(`/publications/lider/form/${encodeURIComponent(selectedProductType)}`).then(r => r.data),
    enabled: isLider && !!selectedProductType,
  })

  // For other providers: load static form schema
  const { data: staticSchema } = useQuery<any>({
    queryKey: ['pub-form', connection.provider],
    queryFn: () => api.get(`/publications/forms/${connection.provider}`).then(r => r.data),
    enabled: !isLider,
  })

  const schema = isLider ? liderSchema : staticSchema

  // Aplicar defaults del schema cuando llega. Solo setea las keys que están
  // ausentes/vacías en formData — preserva lo que el usuario ya tipeó. Ej:
  // warranty default "6 meses" para ML.
  useEffect(() => {
    if (!schema?.fields?.length) return
    setFormData((prev) => {
      const next = { ...prev }
      let changed = false
      for (const f of schema.fields) {
        if (f.default !== undefined && (next[f.key] === undefined || next[f.key] === '')) {
          next[f.key] = f.default
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [schema])

  const buildPayload = (fd: Record<string, any>, extra?: Record<string, any>) => {
    const imageUrls = Array.isArray(fd.images) ? fd.images.filter(Boolean) : []
    const attributes = Object.entries(fd)
      .filter(([k, v]) => k.startsWith('ml_attr_') && v && (v as any).id)
      .map(([, v]) => v)
    // Falabella: fb_attr_FeedName -> top-level formData[FeedName]
    const fbExtras = Object.entries(fd)
      .filter(([k, v]) => k.startsWith('fb_attr_') && v !== undefined && v !== null && v !== '')
      .reduce<Record<string, any>>((acc, [k, v]) => { acc[k.replace('fb_attr_', '')] = v; return acc }, {})
    const cleanFd = Object.fromEntries(
      Object.entries(fd).filter(([k]) => !k.startsWith('ml_attr_') && !k.startsWith('fb_attr_'))
    )
    const mergedFd = { ...cleanFd, ...fbExtras, ...extra, ...(attributes.length ? { attributes } : {}) }
    return { formData: mergedFd, imageUrls }
  }

  const buildMLValidatePayload = () => {
    const fd = { ...formData }
    const attributes = Object.entries(fd)
      .filter(([k, v]) => k.startsWith('ml_attr_') && v && (v as any).id)
      .map(([, v]) => v)
    const imageUrls = Array.isArray(fd.images) ? fd.images.filter(Boolean) : []
    const payload: Record<string, any> = {
      category_id: fd.categoryId,
      price: Number(fd.price ?? 0),
      currency_id: 'CLP',
      available_quantity: Number(fd.availableQuantity ?? 1),
      buying_mode: 'buy_it_now',
      listing_type_id: fd.listingTypeId || fd.listing_type_id || 'gold_special',
      condition: fd.condition || 'new',
      pictures: imageUrls.map((u: string) => ({ source: u })),
      attributes,
    }
    if (fd.catalog_product_id) payload.catalog_product_id = fd.catalog_product_id
    if (fd.family_name) payload.family_name = fd.family_name
    if (fd.title && !fd.catalog_product_id) payload.title = fd.title
    return payload
  }

  const publishMutation = useMutation({
    mutationFn: () => {
      const payload = isLider
        ? buildPayload(formData, { productType: selectedProductType })
        : buildPayload(formData)
      return api.post(`/publications/product/${product.id}/connection/${connection.id}`, payload)
    },
    onSuccess: () => { toast.success('Producto publicado correctamente'); onSuccess() },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Error al publicar'),
  })

  const setValue = (key: string, value: any) => setFormData(f => ({ ...f, [key]: value }))

  return (
    <div className="bg-white border rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b bg-gray-50 flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-700">
          Publicar en {PROVIDER_LABELS[connection.provider] || connection.provider}
        </p>
        <button onClick={onClose}><X className="w-4 h-4 text-gray-400" /></button>
      </div>
      <div className="p-5 space-y-6">
        {/* Calculadora de precio compartida con el catálogo maestro. Cualquier
            cambio acá actualiza Product.marketplacePricing[provider] y se
            refleja también en el editor del maestro. onCalculatedPriceChange
            sincroniza en vivo el campo `price` del form de publicación con
            el precio sugerido — el usuario no tiene que retipear ni esperar
            a guardar la calculadora. */}
        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <MarketplacePricingBlock
            product={product}
            filterProviders={[connection.provider]}
            compact
            onCalculatedPriceChange={(provider, calculatedPrice) => {
              if (provider !== connection.provider) return
              setFormData(f => ({
                ...f,
                price: calculatedPrice,
                PriceFalabella: calculatedPrice,
              }))
            }}
          />
        </div>

        {/* ML: selector de modo */}
        {isML && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMlMode('catalog')}
                className={cn(
                  'flex-1 px-3 py-2 rounded-xl text-sm font-medium border-2 transition-all',
                  mlMode === 'catalog' ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-gray-200 text-gray-600',
                )}
              >
                Producto del catálogo ML
              </button>
              <button
                type="button"
                onClick={() => setMlMode('custom')}
                className={cn(
                  'flex-1 px-3 py-2 rounded-xl text-sm font-medium border-2 transition-all',
                  mlMode === 'custom' ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-gray-200 text-gray-600',
                )}
              >
                Producto custom (sin catálogo)
              </button>
            </div>

            {mlMode === 'catalog' && (
              <div className="p-3 border border-gray-200 rounded-xl">
                <p className="text-xs text-gray-500 mb-2">
                  Busca el producto en el catálogo ML. Se autocompletan family_name, imágenes y atributos.
                </p>
                <MLCatalogSearch
                  categoryId={formData.categoryId}
                  onSelect={(p) => {
                    setFormData(f => {
                      const next: Record<string, any> = {
                        ...f,
                        catalog_product_id: p.id,
                        family_name: p.family_name || p.name,
                        categoryId: p.category_id || f.categoryId,
                        images: (Array.isArray(f.images) && f.images.length > 0) ? f.images : (p.pictures || []),
                      }
                      for (const a of (p.attributes || [])) {
                        if (!a?.id) continue
                        next[`ml_attr_${a.id}`] = {
                          id: a.id,
                          value_id: a.value_id,
                          value_name: a.value_name,
                          value_struct: a.value_struct,
                        }
                      }
                      return next
                    })
                    toast.success(`Catálogo ML: ${p.name}`)
                  }}
                />
                {formData.catalog_product_id && (
                  <div className="mt-2 px-3 py-2 bg-sky-50 border border-sky-200 rounded-lg text-xs flex items-center justify-between">
                    <span><span className="font-mono text-sky-700">{formData.catalog_product_id}</span> — {formData.family_name}</span>
                    <button
                      type="button"
                      onClick={() => setFormData(f => ({ ...f, catalog_product_id: undefined, family_name: undefined }))}
                      className="text-gray-400 hover:text-red-500"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {mlMode === 'custom' && (
              <div className="p-3 border border-amber-200 bg-amber-50 rounded-xl text-xs text-amber-800">
                <p className="font-medium mb-1">⚠ Cuenta brand/large_seller</p>
                <p>Tu cuenta no acepta títulos custom. ML genera el título a partir de <code className="bg-amber-100 px-1 rounded">family_name</code> + atributos. Define un <code className="bg-amber-100 px-1 rounded">family_name</code> claro abajo.</p>
              </div>
            )}
          </div>
        )}

        {/* Lider: selector de categoría primero */}
        {isLider && (
          <div>
            <label className="text-sm font-medium text-gray-700">
              Categoría del producto (Walmart Item Spec) <span className="text-red-500">*</span>
            </label>
            <p className="text-xs text-gray-400 mt-0.5">
              Los campos del formulario se generan automáticamente desde el Item Spec 4.3 de Walmart Chile
            </p>
            <select
              value={selectedProductType}
              onChange={e => setSelectedProductType(e.target.value)}
              className="mt-2 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="">Seleccionar categoría...</option>
              {productTypes?.map(pt => (
                <option key={pt.id} value={pt.id}>{pt.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Loading del spec */}
        {isLider && selectedProductType && loadingLiderSchema && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-sky-500" />
            <span className="ml-2 text-sm text-gray-500">Cargando campos desde Item Spec de Walmart...</span>
          </div>
        )}

        {/* Formulario */}
        {(!isLider || (selectedProductType && schema)) && (
          <>
            <FormFields
              fields={schema?.fields ?? []}
              formData={formData}
              setValue={setValue}
              provider={connection.provider}
              setFormData={setFormData}
              productId={product?.id}
            />

            {/* ML: Validar antes de publicar */}
            {isML && formData.categoryId && (
              <MLValidateButton buildPayload={buildMLValidatePayload} />
            )}

            <div className="flex gap-3 pt-2 border-t">
              <button onClick={onClose}
                className="px-4 py-2 border border-gray-200 rounded-xl text-sm font-medium text-gray-600">
                Cancelar
              </button>
              <button
                onClick={() => publishMutation.mutate()}
                disabled={publishMutation.isPending || (isLider && !selectedProductType)}
                className="flex-1 px-4 py-2 bg-sky-600 text-white rounded-xl text-sm font-medium hover:bg-sky-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {publishMutation.isPending
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Publicando...</>
                  : <><Send className="w-4 h-4" /> Publicar en {PROVIDER_LABELS[connection.provider] || connection.provider}</>
                }
              </button>
            </div>
          </>
        )}

        {/* Lider sin categoría seleccionada */}
        {isLider && !selectedProductType && !loadingLiderSchema && (
          <p className="text-center text-sm text-gray-400 py-6">
            Selecciona una categoría para ver los campos requeridos por Walmart Chile
          </p>
        )}
      </div>
    </div>
  )
}
