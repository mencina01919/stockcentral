import { Injectable, Logger } from '@nestjs/common'
import { FormField } from './publications.forms'
import * as path from 'path'
import * as fs from 'fs'

// Resolve spec path: try multiple candidates to handle ts-node (src/) and compiled (dist/) envs
function resolveSpecPath(): string {
  const candidates = [
    path.resolve(__dirname, 'lider-spec.json'),
    path.resolve(__dirname, '../publications/lider-spec.json'),
    path.resolve(process.cwd(), 'apps/api/src/modules/publications/lider-spec.json'),
    path.resolve(process.cwd(), 'src/modules/publications/lider-spec.json'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return candidates[0]
}
const SPEC_PATH = resolveSpecPath()

interface SpecField {
  title: string
  type: string
  required: boolean
  enum?: string[]
  minLength?: number
  maxLength?: number
}

interface ProductTypeSpec {
  required: string[]
  fields: Record<string, SpecField>
}

interface ParsedSpec {
  orderable: {
    required: string[]
    properties: Record<string, SpecField>
  }
  productTypes: Record<string, ProductTypeSpec>
}

let _spec: ParsedSpec | null = null

const logger = new Logger('LiderSpecService')

function loadSpec(): ParsedSpec {
  if (_spec) return _spec
  try {
    logger.log(`Loading Walmart Item Spec from: ${SPEC_PATH}`)
    const raw = fs.readFileSync(SPEC_PATH, 'utf8')
    _spec = JSON.parse(raw) as ParsedSpec
    logger.log(`Spec loaded: ${Object.keys(_spec.productTypes).length} product types`)
  } catch (err: any) {
    logger.error(`Failed to load lider-spec.json: ${err.message}`)
    _spec = { orderable: { required: [], properties: {} }, productTypes: {} }
  }
  return _spec
}

// Fields in Orderable that are managed internally (not shown in form)
const ORDERABLE_INTERNAL = new Set(['sku', 'price', 'ProductIdUpdate', 'SkuUpdate', 'additionalOfferAttributes'])

// Map Walmart spec types to our FormField types
function mapType(field: SpecField): FormField['type'] {
  if (field.type === 'measure') return 'number'
  if (field.type === 'array') return field.enum?.length ? 'select' : 'text'
  if (field.type === 'enum') return 'select'
  if (field.type === 'integer' || field.type === 'number') return 'number'
  if (field.type === 'boolean') return 'boolean'
  return 'text'
}

function specFieldToFormField(key: string, field: SpecField, group: string): FormField {
  const type = mapType(field)
  const hint = field.maxLength ? `Máx. ${field.maxLength} caracteres` : undefined

  return {
    key,
    label: field.title || key,
    type,
    required: field.required,
    options: field.enum?.map(v => ({ label: v, value: v })),
    hint,
    group,
  }
}

@Injectable()
export class LiderSpecService {
  getProductTypes(): { id: string; label: string }[] {
    const spec = loadSpec()
    return Object.keys(spec.productTypes).map(name => ({
      id: name,
      label: name,
    }))
  }

  getFormFields(productType: string): FormField[] {
    const spec = loadSpec()
    const fields: FormField[] = []

    // ── Identification (always first) ───────────────────────────────────────
    fields.push(
      { key: 'productIdType', label: 'Tipo de identificador', type: 'select', required: true, group: 'Identificación',
        options: [{ label: 'UPC', value: 'UPC' }, { label: 'GTIN', value: 'GTIN' }, { label: 'EAN', value: 'EAN' }, { label: 'ISBN', value: 'ISBN' }],
      },
      { key: 'productId', label: 'ID del producto (UPC/GTIN/EAN)', type: 'text', required: true, placeholder: '012345678901', hint: 'Código de barras del producto', group: 'Identificación' },
      { key: 'sku', label: 'SKU', type: 'text', required: true, hint: 'Tu SKU único de vendedor en Walmart Chile', group: 'Identificación' },
    )

    // ── Orderable fields (from spec, excluding internals) ───────────────────
    const orderable = spec.orderable
    for (const key of orderable.required) {
      if (ORDERABLE_INTERNAL.has(key)) continue
      const f = orderable.properties[key]
      if (!f) continue

      if (key === 'ShippingWeight') {
        fields.push({ key: 'shippingWeightValue', label: 'Peso de envío', type: 'number', required: true, placeholder: '1', group: 'Envío y logística' })
        fields.push({ key: 'shippingWeightUnit', label: 'Unidad de peso de envío', type: 'select', required: true, group: 'Envío y logística',
          options: [{ label: 'KG', value: 'KG' }, { label: 'LB', value: 'LB' }, { label: 'G', value: 'G' }],
        })
        continue
      }
      if (key === 'productIdentifiers') continue // handled above
      if (key === 'productName') {
        fields.push({ key: 'productName', label: 'Nombre del producto', type: 'text', required: true, hint: 'Máx. 200 caracteres', group: 'Información básica' })
        continue
      }
      if (key === 'brand') {
        fields.push({ key: 'brand', label: 'Marca', type: 'text', required: true, group: 'Información básica' })
        continue
      }
      fields.push(specFieldToFormField(key, { ...f, required: true }, 'Envío y logística'))
    }

    // Optional orderable fields
    for (const [key, f] of Object.entries(orderable.properties)) {
      if (ORDERABLE_INTERNAL.has(key)) continue
      if (orderable.required.includes(key)) continue
      if (['productIdentifiers', 'ShippingWeight', 'productName', 'brand', 'price'].includes(key)) continue
      if (key === 'fulfillmentLagTime') {
        fields.push({ key: 'fulfillmentLagTime', label: 'Días para preparar el envío', type: 'number', required: false, placeholder: '1', group: 'Envío y logística' })
        continue
      }
      fields.push(specFieldToFormField(key, f, 'Envío y logística'))
    }

    // ── Price & stock ───────────────────────────────────────────────────────
    fields.push(
      { key: 'price', label: 'Precio (CLP)', type: 'number', required: true, group: 'Precio y stock' },
      { key: 'availableQuantity', label: 'Stock disponible', type: 'number', required: true, hint: 'Se sincroniza vía PUT /v3/inventory', group: 'Precio y stock' },
    )

    // ── Images (always required) ────────────────────────────────────────────
    fields.push({
      key: 'images', label: 'Imágenes del producto', type: 'images', required: true,
      hint: 'Primera imagen = imagen principal (mainImageUrl). Hasta 10. Mín. 800×800px JPG, máx 500KB.',
      group: 'Imágenes',
    })

    // ── Visible: category-specific fields ───────────────────────────────────
    const ptSpec = spec.productTypes[productType]
    if (ptSpec) {
      // Required visible fields first
      for (const key of ptSpec.required) {
        if (key === 'mainImageUrl') continue // handled via images field
        const f = ptSpec.fields[key]
        if (!f) continue
        if (key === 'shortDescription') {
          fields.push({ key: 'shortDescription', label: 'Descripción corta', type: 'textarea', required: true, hint: 'Máx. 4000 caracteres', group: 'Descripción' })
          continue
        }
        fields.push(specFieldToFormField(key, { ...f, required: true }, 'Atributos requeridos'))
      }

      // Optional visible fields grouped
      for (const [key, f] of Object.entries(ptSpec.fields)) {
        if (ptSpec.required.includes(key)) continue
        if (key === 'mainImageUrl' || key === 'productSecondaryImageURL') continue
        if (key === 'prop65WarningText') continue // California specific

        // Handle measure objects — split into value + unit fields
        if (f.type === 'measure') {
          fields.push({ key: `${key}_value`, label: `${f.title || key}`, type: 'number', required: false, group: 'Especificaciones' })
          fields.push({ key: `${key}_unit`, label: `Unidad — ${f.title || key}`, type: 'select', required: false, group: 'Especificaciones',
            options: f.enum?.map(v => ({ label: v, value: v })) || [{ label: 'CM', value: 'CM' }, { label: 'IN', value: 'IN' }],
          })
          continue
        }

        fields.push(specFieldToFormField(key, f, 'Especificaciones'))
      }
    }

    return fields
  }

  // Build the MPItem Visible payload from formData for a given productType
  buildVisiblePayload(productType: string, formData: Record<string, any>): Record<string, any> {
    const spec = loadSpec()
    const ptSpec = spec.productTypes[productType]
    const payload: Record<string, any> = { productType }

    if (!ptSpec) return payload

    for (const [key, f] of Object.entries(ptSpec.fields)) {
      if (f.type === 'measure') {
        const val = formData[`${key}_value`]
        const unit = formData[`${key}_unit`]
        if (val !== undefined && val !== '') {
          payload[key] = { measure: String(val), unit: unit || 'CM' }
        }
        continue
      }
      if (key === 'mainImageUrl' || key === 'productSecondaryImageURL') continue
      const val = formData[key]
      if (val !== undefined && val !== '' && val !== null) {
        payload[key] = f.type === 'array' ? (Array.isArray(val) ? val : [val]) : val
      }
    }

    return payload
  }

  // Build the full MPItem Orderable payload from formData
  buildOrderablePayload(formData: Record<string, any>): Record<string, any> {
    const payload: Record<string, any> = {
      sku: formData.sku,
      productName: formData.productName || formData.name,
      brand: formData.brand,
      price: { currentPrice: { value: String(formData.price), currency: 'CLP' } },
      ShippingWeight: {
        measure: String(formData.shippingWeightValue || 1),
        unit: formData.shippingWeightUnit || 'KG',
      },
      productIdentifiers: {
        productIdentifier: [{
          productIdType: formData.productIdType || 'UPC',
          productId: formData.productId,
        }],
      },
    }

    if (formData.fulfillmentLagTime) payload.fulfillmentLagTime = formData.fulfillmentLagTime
    if (formData.multipackQuantity)  payload.multipackQuantity  = String(formData.multipackQuantity)
    if (formData.startDate)          payload.startDate          = formData.startDate
    if (formData.endDate)            payload.endDate            = formData.endDate

    return payload
  }
}
