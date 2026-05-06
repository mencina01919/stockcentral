import { Injectable, Logger, NotFoundException, BadRequestException, ServiceUnavailableException } from '@nestjs/common'
import Anthropic from '@anthropic-ai/sdk'
import { PrismaService } from '../../prisma/prisma.service'
import { MLMetadataService } from './ml-metadata.service'
import { FalabellaMetadataService } from './falabella-metadata.service'
import { LiderSpecService } from './lider-spec.service'
import { ProductsService } from '../products/products.service'

// Haiku 4.5 — barato y rápido para esta tarea
const MODEL = 'claude-haiku-4-5-20251001'

@Injectable()
export class AiAutofillService {
  private readonly logger = new Logger(AiAutofillService.name)
  private readonly client: Anthropic | null

  constructor(
    private prisma: PrismaService,
    private mlMetadata: MLMetadataService,
    private fbMetadata: FalabellaMetadataService,
    private liderSpec: LiderSpecService,
    private productsService: ProductsService,
  ) {
    const key = process.env.ANTHROPIC_API_KEY
    this.client = key ? new Anthropic({ apiKey: key }) : null
  }

  // ─── Helpers compartidos ──────────────────────────────────────────────────

  private async getProductOrThrow(tenantId: string, productId: string) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, tenantId } })
    if (!product) throw new NotFoundException('Producto no encontrado')
    return product
  }

  private buildProductInfo(product: any) {
    return {
      sku: product.sku,
      name: product.name,
      brand: product.brand,
      description: product.description,
      shortDescription: product.shortDescription,
      basePrice: product.basePrice,
      tags: product.tags,
      images: (Array.isArray(product.images) ? product.images : []).slice(0, 3),
    }
  }

  // Generate a valid 13-digit EAN with correct check digit (Chile prefix 789)
  private generateEAN13(seed: string): string {
    let hash = 0
    for (let i = 0; i < seed.length; i++) hash = ((hash << 5) - hash) + seed.charCodeAt(i)
    const base = '789' + Math.abs(hash).toString().padStart(9, '0').slice(0, 9)
    let sum = 0
    for (let i = 0; i < 12; i++) sum += parseInt(base[i], 10) * (i % 2 === 0 ? 1 : 3)
    const check = (10 - (sum % 10)) % 10
    return base + check
  }

  private async callClaude(systemPrompt: any, userContent: string, maxTokens = 4096) {
    if (!this.client) {
      throw new ServiceUnavailableException('ANTHROPIC_API_KEY no configurado en el servidor')
    }
    let response: Anthropic.Messages.Message
    try {
      response = await this.client.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      })
    } catch (err: any) {
      this.logger.error(`Anthropic API error: ${err?.message}`)
      throw new ServiceUnavailableException(
        `Error llamando a Claude: ${err?.error?.error?.message || err?.message || 'unknown'}`,
      )
    }
    const text = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    let parsed: any
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      this.logger.warn(`Failed to parse Claude response: ${cleaned.slice(0, 300)}`)
      throw new ServiceUnavailableException('Respuesta de Claude no es JSON válido')
    }
    return {
      parsed,
      meta: {
        model: MODEL,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
      },
    }
  }

  // ─── MercadoLibre ─────────────────────────────────────────────────────────

  async autofillML(tenantId: string, productId: string, categoryId: string) {
    if (!categoryId) throw new BadRequestException('Falta categoryId')
    const product = await this.getProductOrThrow(tenantId, productId)

    const groups = await this.mlMetadata.getCategoryAttributes(categoryId)
    const allAttrs = [...groups.required, ...groups.sellerPackage, ...groups.recommended]

    const attrsForPrompt = allAttrs.map((a: any) => ({
      id: a.id,
      name: a.name,
      value_type: a.value_type,
      required: a.required ?? false,
      hint: a.hint || undefined,
      values: (a.values || []).map((v: any) => ({ id: v.id, name: v.name })),
      allowed_units: (a.allowed_units || []).map((u: any) => u.id),
    }))

    const systemPrompt = [{
      type: 'text' as const,
      text: `Eres un experto en publicaciones para MercadoLibre Chile (MLC). Tu trabajo es completar el formulario de publicación con la mayor precisión posible usando los datos del producto del catálogo maestro.

REGLAS ESTRICTAS:
1. Para atributos con "values", DEBES elegir el "id" de un valor de la lista. Nunca inventes IDs.
2. Si ningún valor de la lista coincide con el producto, omite ese atributo.
3. Para atributos value_type="number_unit", devuelve { number: <num>, unit: <unit_id de allowed_units> }.
4. Para atributos value_type="number" o "string", devuelve un texto/número simple.
5. El título debe estar optimizado para ML: máximo 60 caracteres, marca + modelo + característica principal al inicio. Sin emojis ni signos !.
6. La descripción debe ser larga (1500-3000 chars), con bullets, beneficios destacados, especificaciones técnicas claras. Sin HTML.
7. Sé conservador: si no estás seguro, NO lo incluyas.
8. Devuelve SOLO JSON válido sin markdown ni explicaciones.`,
      cache_control: { type: 'ephemeral' as const },
    }]

    const userContent = `# PRODUCTO DEL CATÁLOGO MAESTRO
${JSON.stringify(this.buildProductInfo(product), null, 2)}

# ATRIBUTOS DE LA CATEGORÍA ML (categoryId: ${categoryId})
${JSON.stringify(attrsForPrompt, null, 2)}

# TAREA
Devuelve un JSON con esta estructura exacta:
{
  "title": "<título optimizado ML, máx 60 chars>",
  "description": "<descripción larga, 1500-3000 chars>",
  "attributes": {
    "<attr_id>": { "value_id": "<id_de_values>", "value_name": "<name>" },     // para enums
    "<attr_id>": { "value_name": "<texto o número>" },                         // string/number
    "<attr_id>": { "value_name": "<num> <unit>", "value_struct": { "number": <num>, "unit": "<unit_id>" } }  // number_unit
  }
}`

    const { parsed, meta } = await this.callClaude(systemPrompt, userContent)

    // Validate attribute ids and option ids
    const attrById = new Map<string, any>(allAttrs.map((a: any) => [a.id, a]))
    const safeAttrs: Record<string, any> = {}
    for (const [attrId, val] of Object.entries(parsed.attributes || {})) {
      const attr = attrById.get(attrId)
      if (!attr) continue
      if ((attr.values || []).length > 0) {
        const allowedIds = new Set((attr.values || []).map((v: any) => v.id))
        if ((val as any)?.value_id && allowedIds.has((val as any).value_id)) {
          const matched = attr.values.find((v: any) => v.id === (val as any).value_id)
          safeAttrs[attrId] = {
            id: attrId,
            value_id: (val as any).value_id,
            value_name: matched?.name ?? (val as any).value_name,
          }
        }
      } else if (attr.value_type === 'number_unit') {
        const num = (val as any)?.value_struct?.number
        const unit = (val as any)?.value_struct?.unit
        const allowedUnits = new Set((attr.allowed_units || []).map((u: any) => u.id))
        if (num !== undefined && allowedUnits.has(unit)) {
          safeAttrs[attrId] = {
            id: attrId,
            value_name: `${num} ${unit}`,
            value_struct: { number: Number(num), unit },
          }
        }
      } else {
        if ((val as any)?.value_name !== undefined && (val as any).value_name !== '') {
          safeAttrs[attrId] = { id: attrId, value_name: String((val as any).value_name) }
        }
      }
    }

    return {
      title: parsed.title || product.name,
      description: parsed.description || product.description || '',
      attributes: safeAttrs,
      meta: { ...meta, attrsTotal: allAttrs.length, attrsFilled: Object.keys(safeAttrs).length },
    }
  }

  // ─── Lider (Walmart Chile) ────────────────────────────────────────────────

  async autofillLider(tenantId: string, productId: string, productType: string) {
    if (!productType) throw new BadRequestException('Falta productType (categoría Lider)')
    const realProduct = await this.getProductOrThrow(tenantId, productId)

    const fields = this.liderSpec.getFormFields(productType)
    const fieldsForPrompt = fields.map((f: any) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      required: f.required ?? false,
      hint: f.hint,
      placeholder: f.placeholder,
      options: f.options,
    }))

    const systemPrompt = [{
      type: 'text' as const,
      text: `Eres un experto en publicaciones para Lider (Walmart Chile). Tu trabajo es completar el formulario de publicación con la mayor precisión posible usando los datos del producto del catálogo maestro.

REGLAS ESTRICTAS:
1. Para campos type="select" con options, DEBES elegir uno de los "value" de las opciones. Nunca inventes valores.
2. Si no estás seguro de un campo, NO lo incluyas.
3. productName: máximo 200 caracteres, claro y descriptivo (no marketing).
4. shortDescription: máximo 500 caracteres, descriptivo.
5. Para campos de medidas/peso (packageWidth, etc.) usa números con la unidad apropiada.
6. Si NO se proporciona UPC/GTIN/EAN en el producto, sugiere productIdType="UPC" y deja productId vacío (lo asignaremos nosotros).
7. brand: si la marca del producto es genérica/desconocida, escribe "Genérica".
8. Devuelve SOLO JSON válido sin markdown ni explicaciones.`,
      cache_control: { type: 'ephemeral' as const },
    }]

    const userContent = `# PRODUCTO DEL CATÁLOGO MAESTRO
${JSON.stringify(this.buildProductInfo(realProduct), null, 2)}

# CAMPOS DEL FORMULARIO LIDER (productType: ${productType})
${JSON.stringify(fieldsForPrompt, null, 2)}

# TAREA
Devuelve un JSON con esta estructura:
{
  "fields": {
    "<field_key>": "<valor>",   // para campos simples
    "<field_key>": "<value>"    // para selects, debe ser uno de los "value" de options
  }
}

Solo incluye campos donde tengas un valor con confianza. Omite los demás.`

    const { parsed, meta } = await this.callClaude(systemPrompt, userContent)

    // Validate fields against the schema
    const fieldByKey = new Map<string, any>(fields.map((f: any) => [f.key, f]))
    const safeFields: Record<string, any> = {}
    for (const [key, val] of Object.entries(parsed.fields || {})) {
      const field = fieldByKey.get(key)
      if (!field) continue
      if (val === null || val === undefined || val === '') continue
      if (field.type === 'select' && field.options?.length) {
        const allowed = new Set(field.options.map((o: any) => o.value))
        if (allowed.has(val)) safeFields[key] = val
      } else if (field.type === 'number') {
        const n = Number(val)
        if (!Number.isNaN(n)) safeFields[key] = n
      } else {
        safeFields[key] = String(val)
      }
    }

    // Si no se sugirió productId, generar UPC válido a partir del SKU
    if (!safeFields.productId && realProduct.sku) {
      safeFields.productId = this.generateEAN13(realProduct.sku)
      safeFields.productIdType = safeFields.productIdType || 'UPC'
    }
    // Asegurar SKU
    if (!safeFields.sku) safeFields.sku = realProduct.sku

    return {
      fields: safeFields,
      meta: { ...meta, fieldsTotal: fields.length, fieldsFilled: Object.keys(safeFields).length },
    }
  }

  // ─── Paris (Cencosud) ─────────────────────────────────────────────────────

  async autofillParis(tenantId: string, productId: string, familyId: string, categoryId: string) {
    if (!familyId) throw new BadRequestException('Falta familyId')
    const product = await this.getProductOrThrow(tenantId, productId)

    const [productAttrs, variantAttrs] = await Promise.all([
      this.productsService.parisAttributes(tenantId, familyId, 'product') as any,
      this.productsService.parisAttributes(tenantId, familyId, 'variant') as any,
    ])

    const summarizeAttr = (a: any) => {
      const opts = a.attributeOptions || []
      const v = a.familyAttributes?.[0]?.attributeValidation
      return {
        id: a.id,
        name: a.name,
        required: !!v?.isRequired,
        maxLength: v?.length,
        // Cap options at 100 to keep prompt size reasonable; brand has 28k options
        options: opts.length > 100
          ? opts.slice(0, 100).map((o: any) => ({ id: o.id, name: o.name }))
          : opts.map((o: any) => ({ id: o.id, name: o.name })),
        optionsCount: opts.length,
      }
    }

    const productList = ((productAttrs as any).results || productAttrs || []).map(summarizeAttr)
    const variantList = ((variantAttrs as any).results || variantAttrs || []).map(summarizeAttr)

    const systemPrompt = [{
      type: 'text' as const,
      text: `Eres un experto en publicaciones para Paris Marketplace (Cencosud). Tu trabajo es completar el formulario de publicación con la mayor precisión posible.

REGLAS ESTRICTAS:
1. Para atributos con "options" (lista cerrada), DEBES elegir el "id" de una opción de la lista. Nunca inventes IDs.
2. Si ningún valor coincide con el producto, omite ese atributo.
3. Para atributos sin options, escribe texto libre respetando el maxLength.
4. Cuando un atributo tiene optionsCount muy alto (>100) y no encuentras match exacto, omítelo (el usuario buscará manualmente).
5. Atributos como "Garantía" y "Plazo Soporte Técnico" deben ser textos comerciales útiles (ej: "12 meses de garantía").
6. "Datos Servicio Técnico" debe describir cómo se gestionan garantías y soporte.
7. Para variantes (Talla, Color), usa "Talla Única" si no hay variantes específicas, y un color sólido apropiado.
8. Devuelve SOLO JSON válido sin markdown ni explicaciones.`,
      cache_control: { type: 'ephemeral' as const },
    }]

    const userContent = `# PRODUCTO DEL CATÁLOGO MAESTRO
${JSON.stringify(this.buildProductInfo(product), null, 2)}

# ATRIBUTOS DE PRODUCTO (familyId: ${familyId})
${JSON.stringify(productList, null, 2)}

# ATRIBUTOS DE VARIANTE
${JSON.stringify(variantList, null, 2)}

# TAREA
Devuelve un JSON con esta estructura:
{
  "name": "<nombre del producto, máx 132 chars>",
  "productAttributes": {
    "<attr_id>": { "id": "<attr_id>", "value": "<option_id_o_texto>", "valueName": "<nombre legible>" }
  },
  "variantAttributes": {
    "<attr_id>": { "id": "<attr_id>", "value": "<option_id>", "valueName": "<nombre legible>" }
  }
}

Solo incluye atributos donde tengas confianza. Omite los demás.`

    const { parsed, meta } = await this.callClaude(systemPrompt, userContent)

    const validateAttrs = (input: Record<string, any>, list: any[]) => {
      const byId = new Map<string, any>(list.map((a: any) => [a.id, a]))
      const safe: Record<string, any> = {}
      for (const [attrId, val] of Object.entries(input || {})) {
        const attr = byId.get(attrId)
        if (!attr) continue
        if ((val as any)?.value === undefined || (val as any).value === null || (val as any).value === '') continue
        if ((attr.options || []).length > 0) {
          const allowed = new Set(attr.options.map((o: any) => o.id))
          if (allowed.has((val as any).value)) {
            const matched = attr.options.find((o: any) => o.id === (val as any).value)
            safe[attrId] = { id: attrId, value: (val as any).value, valueName: matched?.name ?? (val as any).valueName }
          }
        } else {
          // Free text: respect maxLength
          let text = String((val as any).value)
          if (attr.maxLength && text.length > attr.maxLength) text = text.slice(0, attr.maxLength)
          safe[attrId] = { id: attrId, value: text }
        }
      }
      return safe
    }

    const safeProduct = validateAttrs(parsed.productAttributes || {}, productList)
    const safeVariant = validateAttrs(parsed.variantAttributes || {}, variantList)

    return {
      name: parsed.name || product.name,
      sellerSku: product.sku,
      productAttributes: safeProduct,
      variantAttributes: safeVariant,
      meta: {
        ...meta,
        productAttrsTotal: productList.length,
        productAttrsFilled: Object.keys(safeProduct).length,
        variantAttrsTotal: variantList.length,
        variantAttrsFilled: Object.keys(safeVariant).length,
      },
    }
  }

  // ─── Falabella ────────────────────────────────────────────────────────────

  async autofillFalabella(tenantId: string, productId: string, categoryId: string) {
    if (!categoryId) throw new BadRequestException('Falta categoryId')
    const product = await this.getProductOrThrow(tenantId, productId)

    const meta = await this.fbMetadata.getCategoryAttributes(tenantId, categoryId)
    const attrs = (meta as any).attributes || []

    const attrsForPrompt = attrs.map((a: any) => ({
      key: a.feedName,
      label: a.label,
      inputType: a.inputType,
      required: a.isMandatory,
      maxLength: a.maxLength,
      hint: a.description?.split('//')[0]?.trim(),
      example: a.exampleValue,
      options: (a.options || []).slice(0, 100).map((o: any) => ({ id: o.id, name: o.name })),
      optionsCount: (a.options || []).length,
    }))

    const systemPrompt = [{
      type: 'text' as const,
      text: `Eres un experto en publicaciones para Falabella Seller Center. Tu trabajo es completar el formulario de publicación con la mayor precisión posible.

REGLAS ESTRICTAS:
1. Para atributos con inputType="dropdown" o "multipleselect", DEBES elegir el "id" de una opción de la lista. Nunca inventes IDs.
2. Para multipleselect devuelve un array de ids.
3. Para textfield/textarea/numberfield, escribe valor respetando maxLength.
4. Si no estás seguro, omite el campo.
5. Atributos como "Description" deben ser descriptivos y vendedores (no marketing agresivo).
6. Devuelve SOLO JSON válido sin markdown ni explicaciones.`,
      cache_control: { type: 'ephemeral' as const },
    }]

    const userContent = `# PRODUCTO DEL CATÁLOGO MAESTRO
${JSON.stringify(this.buildProductInfo(product), null, 2)}

# ATRIBUTOS DE CATEGORÍA FALABELLA (categoryId: ${categoryId})
${JSON.stringify(attrsForPrompt, null, 2)}

# TAREA
Devuelve un JSON con esta estructura:
{
  "attributes": {
    "<feedName>": "<valor>",         // para textfield/textarea/numberfield
    "<feedName>": "<option_id>",     // para dropdown
    "<feedName>": ["<id1>", "<id2>"] // para multipleselect
  }
}

Solo incluye atributos con valor confiable.`

    const { parsed, meta: claudeMeta } = await this.callClaude(systemPrompt, userContent)

    // Validate
    const byKey = new Map<string, any>(attrs.map((a: any) => [a.feedName, a]))
    const safeAttrs: Record<string, any> = {}
    for (const [key, val] of Object.entries(parsed.attributes || {})) {
      const attr = byKey.get(key)
      if (!attr) continue
      if (val === null || val === undefined || val === '') continue
      if (attr.inputType === 'dropdown' && attr.options?.length) {
        const allowed = new Set(attr.options.map((o: any) => o.id))
        if (allowed.has(val)) safeAttrs[key] = val
      } else if (attr.inputType === 'multipleselect' && attr.options?.length) {
        if (!Array.isArray(val)) continue
        const allowed = new Set(attr.options.map((o: any) => o.id))
        const validIds = (val as string[]).filter((id) => allowed.has(id))
        if (validIds.length) safeAttrs[key] = validIds
      } else if (attr.inputType === 'numberfield') {
        const n = Number(val)
        if (!Number.isNaN(n)) safeAttrs[key] = n
      } else {
        // textfield / textarea / fallback
        let text = String(val)
        if (attr.maxLength && text.length > attr.maxLength) text = text.slice(0, attr.maxLength)
        safeAttrs[key] = text
      }
    }

    return {
      attributes: safeAttrs,
      meta: {
        ...claudeMeta,
        attrsTotal: attrs.length,
        attrsFilled: Object.keys(safeAttrs).length,
      },
    }
  }
}
