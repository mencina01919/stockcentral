import axios, { AxiosInstance } from 'axios'
import {
  IMarketplaceDriver,
  DriverCredentials,
  DriverConfig,
  ConnectionTestResult,
  MarketplaceProduct,
  MarketplaceOrder,
  SyncProductInput,
  SyncResult,
  OAuthTokens,
  PaginatedResult,
} from '../types'

const ML_API = 'https://api.mercadolibre.com'
const ML_AUTH = 'https://auth.mercadolibre.com'

// Site IDs: MLA=Argentina, MLB=Brasil, MLC=Chile, MLM=Mexico, MLU=Uruguay, MLC=Colombia
const SITE_BY_COUNTRY: Record<string, string> = {
  AR: 'MLA',
  BR: 'MLB',
  CL: 'MLC',
  MX: 'MLM',
  UY: 'MLU',
  CO: 'MCO',
  PE: 'MPE',
  VE: 'MLV',
}

// Callback que provee el caller cuando quiere que el driver pueda
// auto-refrescar el token al toparse un 401. Devuelve el nuevo accessToken
// (y opcionalmente refreshToken) tras refrescar contra api.mercadolibre.com.
// El driver lo usa una sola vez por request: si tras refrescar y reintentar
// vuelve a fallar 401, propaga el error.
type RefreshTokenCallback = () => Promise<{ accessToken: string }>

export class MercadoLibreDriver implements IMarketplaceDriver {
  readonly provider = 'mercadolibre'

  // Callback que el caller (sync.service) setea en cada operación que
  // requiere auto-refresh. Si está presente, las llamadas con 401 tratan de
  // refrescar y reintentar una vez. Volvemos a null al terminar la
  // operación para no contaminar otras instancias.
  private onTokenRefresh?: RefreshTokenCallback

  // Permite que el caller registre un callback para auto-refresh. Devuelve
  // un dispose() para limpiarlo al final.
  setRefreshHandler(cb: RefreshTokenCallback | undefined): () => void {
    this.onTokenRefresh = cb
    return () => {
      this.onTokenRefresh = undefined
    }
  }

  // Construye el cliente axios con auto-refresh on-401 si hay handler
  // registrado. Si una llamada falla con 401, intenta refrescar el token
  // una vez vía `onTokenRefresh` y reintenta el request. Si el reintento
  // vuelve a fallar, propaga el error.
  // Un mismo flujo (ej. getOrders + fetchOrderDetail por cada item) comparte
  // el token nuevo gracias a `client.defaults.headers.Authorization`.
  private buildClient(accessToken: string): AxiosInstance {
    const client = axios.create({
      baseURL: ML_API,
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 15000,
    })

    if (!this.onTokenRefresh) return client

    let refreshing: Promise<string> | null = null
    const refreshHandler = this.onTokenRefresh

    client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const status = error?.response?.status
        const config = error?.config as any
        if (status !== 401 || !config || config._retried) {
          return Promise.reject(error)
        }
        config._retried = true
        try {
          // Coalescing: varios 401 simultáneos comparten una sola promesa.
          if (!refreshing) {
            refreshing = refreshHandler()
              .then((r) => r.accessToken)
              .finally(() => { refreshing = null })
          }
          const newToken = await refreshing
          config.headers = { ...(config.headers || {}), Authorization: `Bearer ${newToken}` }
          ;(client.defaults.headers as any).Authorization = `Bearer ${newToken}`
          return client.request(config)
        } catch (refreshErr) {
          return Promise.reject(refreshErr)
        }
      },
    )
    return client
  }

  getAuthUrl(config: DriverConfig): string {
    const { clientId, redirectUri, siteId = 'MLC' } = config as Record<string, string>
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
    })
    return `${ML_AUTH}/authorization?${params.toString()}`
  }

  async exchangeCode(code: string, config: DriverConfig): Promise<OAuthTokens> {
    const { clientId, clientSecret, redirectUri } = config as Record<string, string>
    const res = await axios.post(`${ML_API}/oauth/token`, {
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    })
    return {
      accessToken: res.data.access_token,
      refreshToken: res.data.refresh_token,
      expiresAt: new Date(Date.now() + res.data.expires_in * 1000),
      sellerId: String(res.data.user_id),
    }
  }

  async refreshToken(refreshToken: string, config: DriverConfig): Promise<OAuthTokens> {
    const { clientId, clientSecret } = config as Record<string, string>
    const res = await axios.post(`${ML_API}/oauth/token`, {
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    })
    return {
      accessToken: res.data.access_token,
      refreshToken: res.data.refresh_token,
      expiresAt: new Date(Date.now() + res.data.expires_in * 1000),
      sellerId: String(res.data.user_id),
    }
  }

  async testConnection(credentials: DriverCredentials): Promise<ConnectionTestResult> {
    try {
      const client = this.buildClient(credentials.accessToken)
      const res = await client.get('/users/me')
      return {
        success: true,
        shopName: res.data.nickname,
        sellerId: String(res.data.id),
      }
    } catch (err: any) {
      return { success: false, error: err?.response?.data?.message || err.message }
    }
  }

  async getProducts(
    credentials: DriverCredentials,
    config?: DriverConfig,
    offset = 0,
    limit = 50,
  ): Promise<PaginatedResult<MarketplaceProduct>> {
    const client = this.buildClient(credentials.accessToken)
    const sellerId = credentials.sellerId
    const cfg = (config || {}) as Record<string, any>
    const statusFilter: string | undefined = cfg.statusFilter
    const searchQuery: string | undefined = cfg.searchQuery

    // When a text search is provided, ML supports `q` natively — single call, no multi-status merging needed
    if (searchQuery) {
      const params: Record<string, any> = { q: searchQuery, offset, limit }
      if (statusFilter) params.status = statusFilter
      const res = await client.get(`/users/${sellerId}/items/search`, { params })
      const ids: string[] = res.data.results || []
      const total: number = res.data.paging.total

      if (!ids.length) return { items: [], total, offset, limit, hasMore: offset + limit < total }

      // Fetch details — for search results we don't know the status beforehand,
      // so we trust data.status from the detail endpoint
      const items: MarketplaceProduct[] = []
      for (const chunk of this.chunkArray(ids, 20)) {
        const detailRes = await client.get('/items', { params: { ids: chunk.join(',') } })
        for (const entry of detailRes.data) {
          if (entry.code === 200) items.push(this.mapProduct(entry.body))
        }
      }
      return { items, total, offset, limit, hasMore: offset + limit < total }
    }

    const ML_STATUSES = ['active', 'paused', 'closed'] as const
    const statusesToQuery = statusFilter
      ? [statusFilter as (typeof ML_STATUSES)[number]]
      : [...ML_STATUSES]

    // Get totals for each status to compute virtual offset across statuses
    const countRes = await Promise.all(
      statusesToQuery.map((s) =>
        client
          .get(`/users/${sellerId}/items/search`, { params: { status: s, limit: 1, offset: 0 } })
          .then((r) => ({ status: s, total: r.data.paging.total as number })),
      ),
    )
    const totals = Object.fromEntries(countRes.map((c) => [c.status, c.total])) as Record<string, number>
    const globalTotal = statusesToQuery.reduce((sum, s) => sum + (totals[s] || 0), 0)

    // Walk statuses in order, skip past `offset`, collect up to `limit` IDs
    let remaining = offset
    const idsWithStatus: Array<{ id: string; status: string }> = []

    for (const s of statusesToQuery) {
      if (idsWithStatus.length >= limit) break
      const statusTotal = totals[s] || 0
      if (remaining >= statusTotal) { remaining -= statusTotal; continue }

      const need = limit - idsWithStatus.length
      const res = await client.get(`/users/${sellerId}/items/search`, {
        params: { status: s, offset: remaining, limit: need },
      })
      for (const id of res.data.results as string[]) idsWithStatus.push({ id, status: s })
      remaining = 0
    }

    if (!idsWithStatus.length) {
      return { items: [], total: globalTotal, offset, limit, hasMore: offset + limit < globalTotal }
    }

    const statusById = new Map(idsWithStatus.map(({ id, status }) => [id, status]))
    const ids = idsWithStatus.map((x) => x.id)
    const items: MarketplaceProduct[] = []
    for (const chunk of this.chunkArray(ids, 20)) {
      const detailRes = await client.get('/items', { params: { ids: chunk.join(',') } })
      for (const entry of detailRes.data) {
        if (entry.code === 200) {
          items.push(this.mapProduct(entry.body, statusById.get(entry.body.id)))
        }
      }
    }

    return { items, total: globalTotal, offset, limit, hasMore: offset + limit < globalTotal }
  }

  async findBySku(credentials: DriverCredentials, sku: string): Promise<MarketplaceProduct[]> {
    if (!sku) return []
    const client = this.buildClient(credentials.accessToken)
    const sellerId = credentials.sellerId
    const searchRes = await client.get(`/users/${sellerId}/items/search`, {
      params: { seller_custom_field: sku, limit: 50 },
    })
    const ids: string[] = searchRes.data.results || []
    if (!ids.length) return []
    const detailRes = await client.get('/items', { params: { ids: ids.join(',') } })
    const items: MarketplaceProduct[] = []
    for (const entry of detailRes.data) {
      if (entry.code === 200 && entry.body?.seller_custom_field === sku) {
        items.push(this.mapProduct(entry.body))
      }
    }
    return items
  }

  async getProduct(credentials: DriverCredentials, externalId: string): Promise<MarketplaceProduct | null> {
    try {
      const client = this.buildClient(credentials.accessToken)
      const res = await client.get(`/items/${externalId}`)
      return this.mapProduct(res.data)
    } catch {
      return null
    }
  }

  // Builds the ML attributes array from formData.
  // Merges static fields (brand, gtin, model) with dynamic mlAttributes/attributes from the category search.
  private buildAttributes(fd: Record<string, any>, productAttrs?: any[]): Record<string, unknown>[] {
    // If explicit attributes array provided (from product-level), use as base
    if (Array.isArray(productAttrs) && productAttrs.length > 0) {
      return productAttrs.map((a: any) => {
        const attr: Record<string, unknown> = { id: a.id }
        if (a.value_id !== undefined) attr.value_id = a.value_id
        if (a.value_name !== undefined) attr.value_name = a.value_name
        if (a.value_struct !== undefined) attr.value_struct = a.value_struct
        return attr
      })
    }
    const map = new Map<string, string>()
    // Static known attributes from form fields
    if (fd.brand)   map.set('BRAND',   String(fd.brand))
    if (fd.gtin)    map.set('GTIN',    String(fd.gtin))
    if (fd.model)   map.set('MODEL',   String(fd.model))
    // Dynamic attributes captured from MLAttributeFields (category-specific)
    if (Array.isArray(fd.mlAttributes)) {
      for (const a of fd.mlAttributes) {
        if (a.id && a.value_name) map.set(String(a.id), String(a.value_name))
      }
    }
    return Array.from(map.entries()).map(([id, value_name]) => ({ id, value_name }))
  }

  async createProduct(
    credentials: DriverCredentials,
    product: SyncProductInput,
    config?: DriverConfig,
  ): Promise<SyncResult> {
    try {
      const client = this.buildClient(credentials.accessToken)
      const cfg = (config || {}) as Record<string, any>
      const fd = (product as any).formData as Record<string, any> | undefined ?? {}

      const categoryId = fd.categoryId || (product as any).categoryId || cfg.defaultCategoryId
      if (!categoryId) throw new Error('Se requiere el ID de categoría (categoryId) para publicar en MercadoLibre')

      const productLevelAttrs = Array.isArray((product as any).attributes) ? (product as any).attributes : undefined
      const attributes = this.buildAttributes(fd, productLevelAttrs)

      const catalogProductId = fd.catalog_product_id || (product as any).catalog_product_id
      const familyName = fd.family_name || (product as any).family_name

      const payload: Record<string, unknown> = {
        category_id:        categoryId,
        price:              fd.price ?? product.price,
        currency_id:        cfg.currency || 'CLP',
        available_quantity: fd.availableQuantity ?? product.stock,
        buying_mode:        'buy_it_now',
        listing_type_id:    fd.listingTypeId || fd.listing_type_id || cfg.listingType || 'gold_special',
        condition:          fd.condition || cfg.condition || 'new',
        seller_custom_field: product.sku,
        pictures:           (product.images || []).map((url) => ({ source: url })),
      }

      // Catalog listing mode (required for brand/large_seller accounts)
      if (catalogProductId) {
        payload.catalog_product_id = catalogProductId
        if (familyName) payload.family_name = familyName
      } else {
        payload.title = fd.title || product.title
        if (familyName) payload.family_name = familyName
      }

      if (attributes.length) payload.attributes = attributes

      // Warranty as a sale term (ML-native field for seller warranty text)
      if (fd.warranty) {
        payload.sale_terms = [{ id: 'WARRANTY_TYPE', value_name: 'Garantía del vendedor' }, { id: 'WARRANTY_TIME', value_name: fd.warranty }]
      }

      const res = await client.post('/items', payload)
      const itemId: string = res.data.id

      // ML requires a separate request to set the description
      const descText: string = fd.description || product.description || product.title || ''
      if (descText) {
        await client.post(`/items/${itemId}/description`, { plain_text: descText }).catch(() => {})
      }

      return { success: true, externalId: itemId, rawResponse: res.data }
    } catch (err: any) {
      const data = err?.response?.data
      const causes = Array.isArray(data?.cause)
        ? data.cause.filter((c: any) => c.type !== 'warning').map((c: any) => `${c.code}: ${c.message}`).join(' | ')
        : ''
      return {
        success: false,
        error: causes || data?.message || data?.error || err.message,
        rawResponse: data,
      }
    }
  }

  async updateProduct(
    credentials: DriverCredentials,
    externalId: string,
    product: Partial<SyncProductInput>,
    config?: DriverConfig,
  ): Promise<SyncResult> {
    try {
      const client = this.buildClient(credentials.accessToken)
      const fd = (product as any).formData as Record<string, any> | undefined ?? {}

      const payload: Record<string, unknown> = {}
      const title = fd.title || product.title
      const price = fd.price ?? product.price
      const stock = fd.availableQuantity ?? product.stock
      const condition = fd.condition
      const listingTypeId = fd.listingTypeId

      if (title !== undefined)       payload.title              = title
      if (price !== undefined)       payload.price              = price
      if (stock !== undefined)       payload.available_quantity = stock
      if (condition !== undefined)   payload.condition          = condition
      if (listingTypeId !== undefined) payload.listing_type_id  = listingTypeId

      const pictures = product.images || []
      if (pictures.length) payload.pictures = pictures.map((url) => ({ source: url }))

      const productLevelAttrsUpdate = Array.isArray((product as any).attributes) ? (product as any).attributes : undefined
      const attributes = this.buildAttributes(fd, productLevelAttrsUpdate)
      if (attributes.length) payload.attributes = attributes

      if (fd.warranty) {
        payload.sale_terms = [{ id: 'WARRANTY_TYPE', value_name: 'Garantía del vendedor' }, { id: 'WARRANTY_TIME', value_name: fd.warranty }]
      }

      await client.put(`/items/${externalId}`, payload)

      // Update description separately
      const descText: string = fd.description || product.description || ''
      if (descText) {
        await client.put(`/items/${externalId}/description`, { plain_text: descText }).catch(() => {})
      }

      return { success: true, externalId }
    } catch (err: any) {
      const data = err?.response?.data
      const causes = Array.isArray(data?.cause)
        ? data.cause.filter((c: any) => c.type !== 'warning').map((c: any) => `${c.code}: ${c.message}`).join(' | ')
        : ''
      return {
        success: false,
        error: causes || data?.message || data?.error || err.message,
        rawResponse: data,
      }
    }
  }

  async updateStock(
    credentials: DriverCredentials,
    externalId: string,
    stock: number,
  ): Promise<SyncResult> {
    return this.updateProduct(credentials, externalId, { stock })
  }

  async getOrders(
    credentials: DriverCredentials,
    config?: DriverConfig,
    since?: Date,
    offset = 0,
    limit = 50,
  ): Promise<PaginatedResult<MarketplaceOrder>> {
    const client = this.buildClient(credentials.accessToken)
    const sellerId = credentials.sellerId

    // ML por default ordena por relevancia. Forzamos `date_desc` para que las
    // órdenes más recientes lleguen primero. Sin esto, el sync con limit=50
    // y date_created.from=hace_X_dias trae las primeras 50 órdenes ASC desde
    // ese punto y nunca llega a las recientes en cuentas con muchas órdenes.
    const params: Record<string, unknown> = {
      seller: sellerId,
      offset,
      limit,
      sort: 'date_desc',
    }
    if (since) params['date_created.from'] = since.toISOString()

    const res = await client.get('/orders/search', { params })
    const orders: MarketplaceOrder[] = []
    for (const o of res.data.results) {
      const detailed = await this.fetchOrderDetail(client, o)
      orders.push(this.mapOrder(detailed))
    }
    const total = res.data.paging.total

    return { items: orders, total, offset, limit, hasMore: offset + limit < total }
  }

  async getOrder(credentials: DriverCredentials, externalId: string): Promise<MarketplaceOrder | null> {
    try {
      const client = this.buildClient(credentials.accessToken)
      const res = await client.get(`/orders/${externalId}`)
      const detailed = await this.fetchOrderDetail(client, res.data)
      return this.mapOrder(detailed)
    } catch {
      return null
    }
  }

  // Hydrates an order with shipment receiver + billing_info — both endpoints
  // require separate calls. ML privacy rules omit them from /orders/search.
  private async fetchOrderDetail(client: any, order: any): Promise<any> {
    const shippingId = order.shipping?.id
    const [shipmentData, billingData] = await Promise.all([
      shippingId
        ? client.get(`/shipments/${shippingId}`).then((r: any) => r.data).catch(() => null)
        : Promise.resolve(null),
      client.get(`/orders/${order.id}/billing_info`).then((r: any) => r.data).catch(() => null),
    ])
    return { ...order, _shipment: shipmentData, _billingInfo: billingData }
  }

  async confirmOrder(credentials: DriverCredentials, externalId: string): Promise<SyncResult> {
    try {
      const client = this.buildClient(credentials.accessToken)
      // ML handles confirmation via shipment feedback
      const res = await client.post(`/orders/${externalId}/feedback`, { fulfilled: true })
      return { success: true, externalId }
    } catch (err: any) {
      return { success: false, error: err?.response?.data?.message || err.message }
    }
  }

  private mapProduct(data: any, overrideStatus?: string): MarketplaceProduct {
    // ML's batch /items endpoint can return a different status than /items/search
    // (e.g. sub_status changes). We trust the status from the search when provided.
    const rawStatus = overrideStatus || data.status

    // For items with variations, available_quantity at the root is 0.
    // The real stock is the sum of each variation's available_quantity.
    const variations: any[] = Array.isArray(data.variations) ? data.variations : []
    const stock = variations.length > 0
      ? variations.reduce((sum: number, v: any) => sum + (v.available_quantity ?? 0), 0)
      : (data.available_quantity ?? 0)

    return {
      externalId: data.id,
      externalSku: data.seller_custom_field,
      title: data.title,
      description: data.description?.plain_text,
      price: data.price,
      stock,
      images: data.pictures?.map((p: any) => p.url) || [],
      categoryId: data.category_id,
      status: this.mapStatus(rawStatus),
      url: data.permalink,
      rawData: data,
    }
  }

  private mapOrder(data: any): MarketplaceOrder {
    const buyer = data.buyer || {}
    const ident = buyer.identification || {}
    const shipment = data._shipment || {}
    const receiver = shipment.receiver_address || data.shipping?.receiver_address || {}
    // billing_info endpoint returns { billing_info: { doc_number, doc_type, additional_info: [{type,value}] } }
    const bInfo = data._billingInfo?.billing_info || data._billingInfo || {}
    const additional: Record<string, string> = {}
    for (const kv of bInfo.additional_info || []) {
      if (kv?.type) additional[kv.type] = kv.value
    }

    const billingDocType = bInfo.doc_type || additional.DOC_TYPE
    const billingDocNumber = bInfo.doc_number || additional.DOC_NUMBER
    const billingName =
      additional.BUSINESS_NAME ||
      additional.LEGAL_NAME ||
      (additional.FIRST_NAME
        ? `${additional.FIRST_NAME} ${additional.LAST_NAME || ''}`.trim()
        : undefined)
    const billingAddressLine =
      additional.STREET_NAME
        ? `${additional.STREET_NAME} ${additional.STREET_NUMBER || ''}`.trim()
        : undefined

    const buyerNameFromOrder =
      buyer.first_name || buyer.last_name
        ? `${buyer.first_name || ''} ${buyer.last_name || ''}`.trim()
        : ''
    const buyerNameFromShipment =
      receiver.receiver_name ||
      (receiver.first_name
        ? `${receiver.first_name} ${receiver.last_name || ''}`.trim()
        : '')
    const buyerName = buyerNameFromOrder || buyerNameFromShipment || 'Unknown'

    const buyerPhone =
      receiver.receiver_phone ||
      (buyer.phone?.number
        ? `${buyer.phone.area_code || ''}${buyer.phone.number}`.trim()
        : undefined)

    // ML expone el motivo de cancelación / situaciones especiales en
    // status_detail + tags + cancel_detail. Lo capturamos para distinguir
    // "cancelled por mediación abierta" vs "cancelled normal" en la UI.
    //
    // Importante: data.mediations es un histórico — una orden puede tener
    // mediaciones cerradas (resueltas a favor del comprador o vendedor) y
    // ML las sigue listando. Una mediación está REALMENTE abierta sólo si
    // NO hay cancel_detail todavía. Cuando ML resuelve la mediación con
    // cancelación de la compra, popula cancel_detail con el motivo y la
    // orden pasa a status=cancelled — eso ya NO es "en mediación", es
    // "cancelada por X".
    const tags: string[] = Array.isArray(data.tags) ? data.tags : []
    const hasMediationsRaw = Array.isArray(data.mediations) && data.mediations.length > 0
    const hasCancelDetail = data.cancel_detail && typeof data.cancel_detail === 'object'
    // ML deja `mediations: [...]` como histórico aun cuando ya están cerradas.
    // El verdadero indicador de "mediación abierta" es:
    //   - tags incluye 'mediations' o 'mediation' (ML marca explícitamente la
    //     orden como en mediación), Y
    //   - no hay cancel_detail (si lo hay, la mediación se resolvió cancelando
    //     y la orden ya está cancelada formalmente).
    // Usar solo `mediations.length > 0` da falsos positivos para órdenes que
    // tuvieron mediación pero terminaron entregadas o sin cancelación.
    const hasMediationTag = tags.includes('mediations') || tags.includes('mediation')
    const hasMediations = hasMediationsRaw && hasMediationTag && !hasCancelDetail

    // Caso "no_shipping": el seller envía por su cuenta y ML no rastrea la
    // entrega — la orden queda eternamente con tag `not_delivered` por API.
    // Cuando el seller deja feedback (data.feedback.seller.id presente), eso
    // es la señal que ML usa internamente para considerarla cumplida. Lo
    // exponemos como statusDetail='delivered_no_shipping' para que la UI
    // pueda diferenciar "no entregado real" de "entregado por seller propio".
    const isNoShipping = tags.includes('no_shipping')
    const sellerLeftFeedback = !!data.feedback?.seller?.id
    const fulfilledByNoShipping =
      isNoShipping && data.status === 'paid' && !hasCancelDetail && sellerLeftFeedback

    // Si la cancelación viene con cancel_detail, derivamos un statusDetail
    // legible que la UI puede mapear ("buyer" → cancelada por comprador,
    // "seller" → por vendedor, "ml" → por Mercado Libre, etc.). Si no hay
    // cancel_detail pero el status es cancelled, queda en null y la UI cae
    // al label genérico.
    let derivedStatusDetail: string | undefined = data.status_detail || undefined
    if (!derivedStatusDetail && hasCancelDetail) {
      const group = String(data.cancel_detail.group || '').toLowerCase()
      const requestedBy = String(data.cancel_detail.requested_by || '').toLowerCase()
      // ML usa varios "groups": buyer, seller, ml/mercadolibre, delivery
      // (problemas de envío). Para `delivery` el requested_by indica quién
      // disparó la baja: si es "seller" (vendedor reportó etiqueta ilegible
      // o similar), lo tratamos como cancelación por vendedor para la UI.
      if (group === 'buyer') derivedStatusDetail = 'cancelled_by_buyer'
      else if (group === 'seller') derivedStatusDetail = 'cancelled_by_seller'
      else if (group === 'ml' || group === 'mercadolibre') derivedStatusDetail = 'cancelled_by_ml'
      else if (group === 'delivery') {
        if (requestedBy === 'seller') derivedStatusDetail = 'cancelled_by_seller'
        else if (requestedBy === 'buyer') derivedStatusDetail = 'cancelled_by_buyer'
        else derivedStatusDetail = 'cancelled_by_delivery'
      } else if (group) derivedStatusDetail = `cancelled_by_${group}`
    }
    if (!derivedStatusDetail && fulfilledByNoShipping) {
      derivedStatusDetail = 'delivered_no_shipping'
    }

    return {
      externalId: String(data.id),
      externalOrderNumber: String(data.id),
      packId: data.pack_id ? String(data.pack_id) : undefined,
      status: data.status,
      statusDetail: derivedStatusDetail,
      tags,
      hasMediations,
      buyerName,
      buyerEmail: buyer.email || shipment.receiver_email,
      buyerPhone,
      buyerDocType: ident.type,
      buyerDocNumber: ident.number,
      billing:
        billingName || billingDocNumber
          ? {
              name: billingName,
              docType: billingDocType,
              docNumber: billingDocNumber,
              email: additional.EMAIL || buyer.email,
              phone: additional.PHONE,
              // Presence of BUSINESS_NAME or ECONOMIC_ACTIVITY = factura empresa.
              // Otherwise it's a boleta (consumer).
              invoiceType:
                additional.BUSINESS_NAME || additional.ECONOMIC_ACTIVITY
                  ? 'factura'
                  : 'boleta',
              economicActivity: additional.ECONOMIC_ACTIVITY,
              taxContributor: additional.TAX_CONTRIBUTOR,
            }
          : undefined,
      items: (data.order_items || []).map((item: any) => ({
        externalId: String(item.item?.id),
        sku: item.item?.seller_custom_field || item.item?.id,
        title: item.item?.title,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        totalPrice: (item.full_unit_price ?? item.unit_price) * item.quantity,
      })),
      subtotal: data.total_amount,
      shippingCost: shipment.shipping_option?.cost || data.shipping?.cost || 0,
      total: data.total_amount,
      currency: data.currency_id,
      shippingAddress: receiver.street_name || receiver.address_line
        ? {
            name: buyerName,
            address1: receiver.address_line ||
              `${receiver.street_name || ''} ${receiver.street_number || ''}`.trim(),
            city: receiver.city?.name || receiver.city || '',
            state: receiver.state?.name || receiver.state,
            zipCode: receiver.zip_code,
            country: receiver.country?.id || receiver.country || 'CL',
            phone: buyerPhone,
          }
        : undefined,
      billingAddress:
        billingAddressLine
          ? {
              name: billingName || '',
              address1: billingAddressLine,
              city: additional.CITY_NAME || '',
              state: additional.STATE_NAME,
              zipCode: additional.ZIP_CODE,
              country: additional.COUNTRY_ID || 'CL',
            }
          : undefined,
      createdAt: new Date(data.date_created),
      updatedAt: new Date(data.last_updated),
      rawData: data,
    }
  }

  private mapStatus(status: string): MarketplaceProduct['status'] {
    const map: Record<string, MarketplaceProduct['status']> = {
      active: 'active',
      paused: 'paused',
      closed: 'closed',
      under_review: 'unknown',
      inactive: 'paused',
    }
    return map[status] || 'unknown'
  }

  private chunkArray<T>(arr: T[], size: number): T[][] {
    return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
      arr.slice(i * size, i * size + size),
    )
  }

  // ─── Upload de DTE (boleta/factura) a Mercado Libre ──────────────────────
  // Endpoint: POST /packs/{pack_id}/fiscal_documents (multipart). Si la orden
  // no es parte de un pack, ML acepta order_id como fallback. Acepta PDF
  // (máx 1 MB) y opcionalmente XML adicional.
  //
  // Limitaciones documentadas:
  //   - Solo Chile (MLC) y Brasil. Para MLA no aplica.
  //   - El integrador valida que el RUT del comprador coincida con el del DTE.
  //   - No diferencia boleta/factura: el endpoint guarda el archivo tal cual.
  //
  // Referencias:
  //   https://developers.mercadolibre.com.ar/en_us/upload-invoices
  //   https://developers.mercadolibre.cl/es_ar/facturacion
  async uploadInvoice(
    credentials: DriverCredentials,
    input: {
      // Si la orden tiene packId, usarlo; si no, el externalOrderId.
      packOrOrderId: string
      // Buffer del archivo (PDF preferido por ML — máx 1 MB).
      pdfBuffer: Buffer
      pdfFilename?: string
      // Opcional: XML DTE firmado por SII para reforzar validación.
      xmlBuffer?: Buffer
      xmlFilename?: string
    },
  ): Promise<{ success: boolean; rawResponse?: unknown; error?: string }> {
    const accessToken = credentials.accessToken
    if (!accessToken) {
      return { success: false, error: 'ML: accessToken faltante' }
    }
    if (!input.packOrOrderId) {
      return { success: false, error: 'ML: packOrOrderId requerido' }
    }
    if (!input.pdfBuffer || input.pdfBuffer.length === 0) {
      return { success: false, error: 'ML: pdfBuffer vacío' }
    }
    if (input.pdfBuffer.length > 1024 * 1024) {
      return {
        success: false,
        error: `ML: el PDF supera 1 MB (${input.pdfBuffer.length} bytes)`,
      }
    }

    try {
      // FormData global está disponible en Node 18+ (undici). Cast a `any`
      // para evitar fricción de tipos entre Buffer/Uint8Array<ArrayBufferLike>
      // y BlobPart en TS 5.x con Node 22 — en runtime acepta Buffer sin problema.
      const fd = new FormData()
      const pdfBlob = new Blob([input.pdfBuffer as any], { type: 'application/pdf' })
      fd.append('fiscal_document', pdfBlob, input.pdfFilename || 'document.pdf')
      if (input.xmlBuffer && input.xmlBuffer.length > 0) {
        const xmlBlob = new Blob([input.xmlBuffer as any], { type: 'application/xml' })
        fd.append('fiscal_document', xmlBlob, input.xmlFilename || 'document.xml')
      }

      const url = `${ML_API}/packs/${input.packOrOrderId}/fiscal_documents`
      const res = await axios.post(url, fd, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 30000,
        maxBodyLength: 5 * 1024 * 1024,
      })
      return { success: true, rawResponse: res.data }
    } catch (err: any) {
      const status = err?.response?.status
      const data = err?.response?.data
      const msg =
        data?.message ||
        data?.error ||
        err?.message ||
        'ML uploadInvoice: error desconocido'
      return { success: false, error: `${status ? `[${status}] ` : ''}${msg}`, rawResponse: data }
    }
  }
}
