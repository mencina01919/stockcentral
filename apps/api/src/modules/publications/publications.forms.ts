export interface FormField {
  key: string
  label: string
  type: 'text' | 'number' | 'select' | 'multiselect' | 'textarea' | 'boolean' | 'url' | 'images'
  required: boolean
  options?: { label: string; value: string | number }[]
  placeholder?: string
  hint?: string
  group?: string
  maxLength?: number
  default?: string | number | boolean
}

export interface MarketplaceFormSchema {
  provider: string
  label: string
  fields: FormField[]
}

export const MARKETPLACE_FORMS: Record<string, MarketplaceFormSchema> = {

  // ─── MercadoLibre Chile ───────────────────────────────────────────────────
  // API: POST /items (site_id=MLC, currency_id=CLP, buying_mode=buy_it_now)
  // Imágenes: vía POST /items/{id}/description y PUT /items/{id}/pictures (hasta 10)
  // Stock: campo available_quantity en la creación
  mercadolibre: {
    provider: 'mercadolibre',
    label: 'MercadoLibre',
    fields: [
      // Información básica
      { key: 'sku',                label: 'SKU del maestro',            type: 'text',    required: true,  placeholder: 'Ej: 1977', hint: 'SKU único en el catálogo maestro de StockCentral. Si vinculás un producto del maestro, se completa automáticamente.', group: 'Información básica' },
      { key: 'categoryId',         label: 'Categoría',                   type: 'text',    required: true,  placeholder: 'Buscar...', hint: 'Busca por nombre. ML define los atributos según la categoría seleccionada.', group: 'Información básica' },
      { key: 'family_name',         label: 'Nombre de familia (family_name)', type: 'text', required: true, maxLength: 60, placeholder: 'Mouse Gamer RGB', hint: 'Determina el título generado por ML. Máximo 60 caracteres. Si elegiste un producto del catálogo, se completa automáticamente.', group: 'Información básica' },
      { key: 'condition',          label: 'Condición',                  type: 'select',  required: true,  group: 'Información básica',
        options: [{ label: 'Nuevo', value: 'new' }, { label: 'Usado', value: 'used' }, { label: 'No especificado', value: 'not_specified' }],
      },
      { key: 'listingTypeId',      label: 'Tipo de publicación',        type: 'select',  required: true,  group: 'Información básica',
        options: [
          { label: 'Gratis', value: 'free' },
          { label: 'Clásico', value: 'bronze' },
          { label: 'Premium', value: 'gold_special' },
        ],
      },
      { key: 'gtin',               label: 'GTIN / EAN / UPC',           type: 'text',    required: false, placeholder: '7891234567890', hint: 'Código de barras del producto (recomendado)', group: 'Información básica' },
      { key: 'brand',              label: 'Marca',                      type: 'text',    required: false, placeholder: 'Samsung', group: 'Información básica' },
      { key: 'warranty',           label: 'Garantía',                   type: 'text',    required: true,  default: '6 meses', placeholder: '6 meses garantía del fabricante', hint: 'ML requiere garantía. Por defecto 6 meses.', group: 'Información básica' },
      { key: 'description',        label: 'Descripción',                type: 'textarea', required: false, hint: 'Solo texto plano. Si vinculás un producto del catálogo maestro, se auto-completa desde ahí.', group: 'Información básica' },
      // Precio y stock
      { key: 'price',              label: 'Precio de venta (CLP)',      type: 'number',  required: true,  group: 'Precio y stock' },
      { key: 'availableQuantity',  label: 'Cantidad disponible',        type: 'number',  required: true,  placeholder: '10', group: 'Precio y stock' },
      // Imágenes (hasta 10, mínimo 500×500px, máx 10MB)
      { key: 'images',             label: 'Imágenes del producto',      type: 'images',  required: false, hint: 'Hasta 10 imágenes. Mín 500×500px, máx 1920×1920px, máx 10MB cada una. JPG recomendado.', group: 'Imágenes' },
    ],
  },

  // ─── Paris / Cencosud ────────────────────────────────────────────────────
  // API: Octopia REST API (usado por Cencosud para Paris y Jumbo)
  // Paris (Cencosud Marketplace) — el formulario es 100% dinámico:
  //   - Familia → define las categorías y atributos disponibles
  //   - Categoría → obligatoria al publicar
  //   - Atributos producto y variante → vienen de /v2/attributes/{kind}/family/{familyId}
  //   - Precios → tipos vienen de /v2/price-types (Precio, Precio oferta, etc.)
  // Aquí solo declaramos los anclajes mínimos que disparan el render dinámico.
  paris: {
    provider: 'paris',
    label: 'Paris (Cencosud)',
    fields: [
      { key: 'name',       label: 'Nombre del producto', type: 'text', required: true, hint: 'Máx. 132 caracteres', group: 'Información básica' },
      { key: 'sellerSku',  label: 'SKU del vendedor',    type: 'text', required: true, hint: 'Tu referencia interna. 1-50 caracteres, única.', group: 'Información básica' },
      { key: 'familyId',   label: 'Familia',             type: 'text', required: true, hint: 'Define las categorías y atributos del producto', group: 'Información básica' },
      { key: 'categoryId', label: 'Categoría',           type: 'text', required: true, hint: 'Selecciona después de elegir la familia', group: 'Información básica' },
      { key: 'images',     label: 'Imágenes del producto', type: 'images', required: true, hint: 'Mínimo 1 imagen. Recomendado 800×800px JPG.', group: 'Imágenes' },
    ],
  },

  // ─── Falabella ────────────────────────────────────────────────────────────
  // API: Seller Center API (HMAC + XML for writes, JSON for reads)
  // Los campos son TOTALMENTE dinámicos por categoría — vienen de
  // GetCategoryAttributes en runtime. Aquí solo declaramos los anclajes mínimos
  // que el frontend usa para arrancar el flujo (categoría + SKU + imágenes).
  falabella: {
    provider: 'falabella',
    label: 'Falabella',
    fields: [
      { key: 'PrimaryCategory',  label: 'Categoría',          type: 'text',   required: true, placeholder: 'Buscar...', hint: 'Selecciona la categoría. Falabella define los atributos según la categoría elegida.', group: 'Información básica' },
      { key: 'SellerSku',         label: 'SKU del vendedor',   type: 'text',   required: true, hint: 'Identificador único tuyo para este producto', group: 'Información básica' },
      { key: 'images',            label: 'Imágenes del producto', type: 'images', required: true, hint: 'Hasta 8 imágenes. URLs públicamente accesibles. La primera es la principal.', group: 'Imágenes' },
    ],
  },

  // ─── Lider / Walmart Chile ───────────────────────────────────────────────
  // API: POST /v3/feeds?feedType=item (MP_ITEM feed, Item Spec v4.x)
  // Campos basados en el portal de seller de Lider (Walmart Chile)
  // Stock: vía PUT /v3/inventory?sku={sku} separado
  lider: {
    provider: 'lider',
    label: 'Lider (Walmart Chile)',
    fields: [
      // ── Identificación ───────────────────────────────────────────────────
      { key: 'productIdType',      label: 'Tipo de identificador',      type: 'select',  required: true,  group: 'Identificación',
        options: [{ label: 'UPC', value: 'UPC' }, { label: 'GTIN', value: 'GTIN' }, { label: 'EAN', value: 'EAN' }, { label: 'ISBN', value: 'ISBN' }],
      },
      { key: 'productId',          label: 'ID del producto (UPC/GTIN/EAN)', type: 'text', required: true, placeholder: '012345678901', hint: 'Código de barras del producto', group: 'Identificación' },
      { key: 'sku',                label: 'SKU',                        type: 'text',    required: true,  hint: 'Tu SKU único de vendedor en Walmart', group: 'Identificación' },

      // ── Distribución ─────────────────────────────────────────────────────
      { key: 'fulfillmentType',    label: 'Preparado por',              type: 'select',  required: true,  group: 'Distribución',
        options: [{ label: 'Preparado por el seller', value: 'SELLER' }, { label: 'Preparado por Walmart (WFS)', value: 'WALMART' }],
      },

      // ── Categoría y nombre ────────────────────────────────────────────────
      { key: 'categoryId',         label: 'Categoría',                  type: 'text',    required: true,  placeholder: 'Computadores', hint: 'Categoría exacta según el portal de Lider. Ej: Computadores, Televisores, Smartphones', group: 'Categoría y nombre' },
      { key: 'name',               label: 'Nombre del producto',        type: 'text',    required: true,  hint: 'Nombre completo tal como aparecerá en lider.cl', group: 'Categoría y nombre' },
      { key: 'model',              label: 'Modelo',                     type: 'text',    required: true,  placeholder: 'Galaxy S24', group: 'Categoría y nombre' },
      { key: 'brand',              label: 'Marca',                      type: 'text',    required: true,  group: 'Categoría y nombre' },
      { key: 'manufacturer',       label: 'Fabricante',                 type: 'text',    required: true,  hint: 'Nombre del fabricante del producto', group: 'Categoría y nombre' },
      { key: 'color',              label: 'Color',                      type: 'text',    required: true,  placeholder: 'Negro', group: 'Categoría y nombre' },
      { key: 'countryOfOrigin',    label: 'País de origen',             type: 'select',  required: true,  group: 'Categoría y nombre',
        options: [
          { label: 'China', value: 'CN' }, { label: 'Chile', value: 'CL' }, { label: 'Estados Unidos', value: 'US' },
          { label: 'Corea del Sur', value: 'KR' }, { label: 'Japón', value: 'JP' }, { label: 'Taiwán', value: 'TW' },
          { label: 'México', value: 'MX' }, { label: 'Brasil', value: 'BR' }, { label: 'Alemania', value: 'DE' }, { label: 'Otro', value: 'OTHER' },
        ],
      },
      { key: 'condition',          label: 'Condición del producto',     type: 'select',  required: true,  group: 'Categoría y nombre',
        options: [{ label: 'Nuevo', value: 'New' }, { label: 'Reacondicionado', value: 'Refurbished' }, { label: 'Usado', value: 'Used' }],
      },

      // ── Descripciones ─────────────────────────────────────────────────────
      { key: 'shortDescription',   label: 'Descripción corta',          type: 'textarea',required: true,  hint: 'Visible en el listing. Máx. 4000 caracteres.', group: 'Descripciones' },
      { key: 'longDescription',    label: 'Descripción larga',          type: 'textarea',required: true,  hint: 'Descripción detallada del producto', group: 'Descripciones' },
      { key: 'keywords',           label: 'Palabras clave',             type: 'text',    required: false, placeholder: 'laptop, notebook, computador portátil', hint: 'Separadas por coma. Ayudan al posicionamiento en búsqueda.', group: 'Descripciones' },

      // ── Imágenes ──────────────────────────────────────────────────────────
      { key: 'images',             label: 'Imágenes del producto',      type: 'images',  required: true,  hint: 'Primera imagen = imagen principal. Hasta 10 imágenes. Recomendado 800×800px JPG, máx 500KB.', group: 'Imágenes' },

      // ── Precio y oferta ───────────────────────────────────────────────────
      { key: 'price',              label: 'Precio (CLP)',               type: 'number',  required: true,  group: 'Precio y oferta' },
      { key: 'availableQuantity',  label: 'Cantidad del producto',      type: 'number',  required: true,  hint: 'Stock inicial. Se sincronizará vía API de inventario.', group: 'Precio y oferta' },
      { key: 'publishStartDate',   label: 'Fecha de publicación',       type: 'text',    required: false, placeholder: 'YYYY-MM-DD', group: 'Precio y oferta' },
      { key: 'publishEndDate',     label: 'Fecha de término',           type: 'text',    required: false, placeholder: 'YYYY-MM-DD', group: 'Precio y oferta' },

      // ── Garantía ──────────────────────────────────────────────────────────
      { key: 'warrantyText',       label: 'Garantía',                   type: 'text',    required: true,  placeholder: '12 meses garantía del fabricante', group: 'Garantía' },
      { key: 'sellerWarranty',     label: 'Garantía del vendedor',      type: 'text',    required: true,  placeholder: 'Garantía directa del vendedor', group: 'Garantía' },
      { key: 'warrantyConditions', label: 'Condiciones de garantía',    type: 'textarea',required: true,  placeholder: 'Garantía válida en Chile. No cubre daños por mal uso.', group: 'Garantía' },
      { key: 'warrantyDuration',   label: 'Duración de garantía (meses)', type: 'number', required: true, placeholder: '12', group: 'Garantía' },
      { key: 'warrantyUrl',        label: 'URL de garantía',            type: 'url',     required: false, group: 'Garantía' },

      // ── Dimensiones y peso (requeridos por Walmart) ───────────────────────
      { key: 'heightValue',        label: 'Alto',                       type: 'number',  required: true,  group: 'Dimensiones y peso' },
      { key: 'heightUnit',         label: 'Unidad de alto',             type: 'select',  required: true,  group: 'Dimensiones y peso',
        options: [{ label: 'CM', value: 'CM' }, { label: 'IN', value: 'IN' }, { label: 'MM', value: 'MM' }],
      },
      { key: 'widthValue',         label: 'Ancho',                      type: 'number',  required: true,  group: 'Dimensiones y peso' },
      { key: 'widthUnit',          label: 'Unidad de ancho',            type: 'select',  required: true,  group: 'Dimensiones y peso',
        options: [{ label: 'CM', value: 'CM' }, { label: 'IN', value: 'IN' }, { label: 'MM', value: 'MM' }],
      },
      { key: 'lengthValue',        label: 'Largo',                      type: 'number',  required: true,  group: 'Dimensiones y peso' },
      { key: 'lengthUnit',         label: 'Unidad de largo',            type: 'select',  required: true,  group: 'Dimensiones y peso',
        options: [{ label: 'CM', value: 'CM' }, { label: 'IN', value: 'IN' }, { label: 'MM', value: 'MM' }],
      },
      { key: 'weightValue',        label: 'Peso',                       type: 'number',  required: true,  group: 'Dimensiones y peso' },
      { key: 'weightUnit',         label: 'Unidad de peso',             type: 'select',  required: true,  group: 'Dimensiones y peso',
        options: [{ label: 'KG', value: 'KG' }, { label: 'LB', value: 'LB' }, { label: 'G', value: 'G' }],
      },

      // ── Contenido del producto ─────────────────────────────────────────────
      { key: 'productContents',    label: 'Contenido del producto',     type: 'textarea',required: false, hint: 'Qué incluye la caja. Ej: 1 laptop, 1 cargador, 1 manual', group: 'Contenido' },
      { key: 'multipackQuantity',  label: 'Cantidad multipack',         type: 'number',  required: false, placeholder: '1', group: 'Contenido' },
      { key: 'pieceCount',         label: 'Número de piezas',           type: 'number',  required: false, placeholder: '1', group: 'Contenido' },

      // ── Extras ────────────────────────────────────────────────────────────
      { key: 'taxCode',            label: 'Código de impuesto',         type: 'text',    required: false, placeholder: 'GENERAL', group: 'Extras' },
      { key: 'externalProductId',  label: 'ID de producto externo',     type: 'text',    required: false, group: 'Extras' },
    ],
  },

  // ─── Shopify ──────────────────────────────────────────────────────────────
  // API: REST Admin API POST /admin/api/products.json (legacy, aún vigente)
  // Solo "title" es obligatorio. Stock vía Inventory API separado.
  // Imágenes: array de URLs o base64 en la creación
  shopify: {
    provider: 'shopify',
    label: 'Shopify',
    fields: [
      // Información básica
      { key: 'title',              label: 'Título del producto',        type: 'text',    required: true,  group: 'Información básica' },
      { key: 'vendor',             label: 'Marca / Vendor',             type: 'text',    required: false, group: 'Información básica' },
      { key: 'productType',        label: 'Tipo de producto',           type: 'text',    required: false, hint: 'Ej: Electrónica, Ropa, Hogar', group: 'Información básica' },
      { key: 'bodyHtml',           label: 'Descripción (HTML)',          type: 'textarea',required: false, group: 'Información básica' },
      { key: 'tags',               label: 'Etiquetas (separadas por coma)', type: 'text', required: false, placeholder: 'electrónica, samsung, tv', group: 'Información básica' },
      // Precio y stock
      { key: 'price',              label: 'Precio',                     type: 'number',  required: true,  group: 'Precio y stock' },
      { key: 'compareAtPrice',     label: 'Precio tachado (comparación)', type: 'number',required: false, hint: 'Se muestra tachado junto al precio de oferta', group: 'Precio y stock' },
      { key: 'availableQuantity',  label: 'Stock disponible',           type: 'number',  required: false, hint: 'Requiere gestión de inventario activa en la tienda', group: 'Precio y stock' },
      // Imágenes
      { key: 'images',             label: 'Imágenes del producto',      type: 'images',  required: false, hint: 'Se subirán vía API de Shopify. URLs públicas accesibles.', group: 'Imágenes' },
      // Publicación
      { key: 'status',             label: 'Estado de publicación',      type: 'select',  required: true,  group: 'Publicación',
        options: [
          { label: 'Activo (visible)', value: 'active' },
          { label: 'Borrador',         value: 'draft' },
          { label: 'Archivado',        value: 'archived' },
        ],
      },
    ],
  },

  // ─── WooCommerce ──────────────────────────────────────────────────────────
  // API: REST API POST /wp-json/wc/v3/products
  // Stock: campo stock_quantity, manage_stock: true
  // Imágenes: array de { src } en la creación
  woocommerce: {
    provider: 'woocommerce',
    label: 'WooCommerce',
    fields: [
      // Información básica
      { key: 'name',               label: 'Nombre del producto',        type: 'text',    required: true,  group: 'Información básica' },
      { key: 'sku',                label: 'SKU',                        type: 'text',    required: false, group: 'Información básica' },
      { key: 'description',        label: 'Descripción larga',          type: 'textarea',required: false, group: 'Información básica' },
      { key: 'shortDescription',   label: 'Descripción corta',          type: 'textarea',required: false, group: 'Información básica' },
      { key: 'categoryIds',        label: 'IDs de categorías WC',       type: 'text',    required: false, hint: 'IDs separados por coma. Ej: 12,34', group: 'Información básica' },
      { key: 'tags',               label: 'Etiquetas',                  type: 'text',    required: false, placeholder: 'electrónica, samsung', group: 'Información básica' },
      // Precio y stock
      { key: 'regularPrice',       label: 'Precio regular',             type: 'number',  required: true,  group: 'Precio y stock' },
      { key: 'salePrice',          label: 'Precio oferta',              type: 'number',  required: false, group: 'Precio y stock' },
      { key: 'manageStock',        label: 'Gestionar stock',            type: 'boolean', required: false, group: 'Precio y stock' },
      { key: 'availableQuantity',  label: 'Stock disponible',           type: 'number',  required: false, hint: 'Solo si "Gestionar stock" está activo', group: 'Precio y stock' },
      // Imágenes
      { key: 'images',             label: 'Imágenes del producto',      type: 'images',  required: false, hint: 'URLs públicas. La primera será la imagen principal.', group: 'Imágenes' },
      // Publicación
      { key: 'status',             label: 'Estado',                     type: 'select',  required: true,  group: 'Publicación',
        options: [
          { label: 'Publicado', value: 'publish' },
          { label: 'Borrador',  value: 'draft' },
          { label: 'Privado',   value: 'private' },
        ],
      },
    ],
  },

  // ─── Jumpseller ──────────────────────────────────────────────────────────
  // API: REST API POST /api/v1/products
  // Stock: stock field en variantes (default variant)
  // Imágenes: images[] array de URLs
  jumpseller: {
    provider: 'jumpseller',
    label: 'Jumpseller',
    fields: [
      // Información básica
      { key: 'name',               label: 'Nombre del producto',        type: 'text',    required: true,  group: 'Información básica' },
      { key: 'description',        label: 'Descripción',                type: 'textarea',required: false, hint: 'HTML permitido', group: 'Información básica' },
      { key: 'categoryId',         label: 'ID de categoría',            type: 'number',  required: false, group: 'Información básica' },
      { key: 'brand',              label: 'Marca',                      type: 'text',    required: false, group: 'Información básica' },
      // Precio y stock
      { key: 'price',              label: 'Precio',                     type: 'number',  required: true,  group: 'Precio y stock' },
      { key: 'availableQuantity',  label: 'Stock disponible',           type: 'number',  required: false, group: 'Precio y stock' },
      { key: 'weight',             label: 'Peso (kg)',                  type: 'number',  required: false, group: 'Precio y stock' },
      // Imágenes
      { key: 'images',             label: 'Imágenes del producto',      type: 'images',  required: false, hint: 'URLs públicas de las imágenes del producto.', group: 'Imágenes' },
      // Publicación
      { key: 'status',             label: 'Estado',                     type: 'select',  required: true,  group: 'Publicación',
        options: [
          { label: 'Disponible',     value: 'available' },
          { label: 'No disponible',  value: 'not-available' },
        ],
      },
    ],
  },
}
