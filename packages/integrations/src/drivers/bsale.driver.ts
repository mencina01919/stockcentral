// Driver del facturador electrónico Bsale (api.bsale.io).
// Implementa ITaxDocumentEmitter — capa agnóstica al provider definida en
// types/billing.ts. Multi-tenant: las credenciales y officeId vienen por
// llamada (no se almacenan en el driver).

import axios, { AxiosInstance } from 'axios'
import type { DriverCredentials, DriverConfig } from '../types/index'
import type {
  ITaxDocumentEmitter,
  TaxClientInput,
  EmitDocumentInput,
  EmitCreditNoteInput,
  EmitDocumentResult,
  UpsertClientResult,
  BillingConnectionTest,
} from '../types/billing'

const BSALE_API = 'https://api.bsale.io/v1'

// codeSii — Servicio de Impuestos Internos (Chile).
const SII_BOLETA = 39
const SII_FACTURA = 33
const SII_NOTA_CREDITO = 61

// El taxId NO tiene default. Cada cuenta Bsale tiene su propio ID interno
// para el IVA y emitir un DTE sin taxId genera un documento exento (que el
// SII puede rechazar y que el cliente NO quiere). El driver falla duro si
// no está configurado en la conexión.

export class BsaleDriver implements ITaxDocumentEmitter {
  provider = 'bsale'

  // ─── HTTP client ──────────────────────────────────────────────────────────

  private client(credentials: DriverCredentials): AxiosInstance {
    const token = credentials.accessToken
    if (!token) {
      throw new Error('Bsale: accessToken faltante en credentials')
    }
    return axios.create({
      baseURL: BSALE_API,
      headers: { access_token: token },
      timeout: 20000,
    })
  }

  private officeId(config?: DriverConfig): number {
    const v = config?.officeId
    if (v == null || v === '') {
      throw new Error('Bsale: officeId no configurado en la conexión')
    }
    return Number(v)
  }

  // Bsale exige `taxId` en cada detail con un formato peculiar: una STRING
  // con shape de array literal (ej. "[1]" o "[1,2]"). Si se manda como array
  // JS, Bsale lo descarta silenciosamente y emite el documento como EXENTO.
  // Devolvemos el string ya formateado.
  private taxIdString(config?: DriverConfig): string {
    const v = config?.taxIdIVA
    let ids: string[] = []
    if (Array.isArray(v)) {
      ids = v.map(String).filter(Boolean)
    } else if (typeof v === 'string' && v.length > 0) {
      ids = [v]
    } else if (typeof v === 'number') {
      ids = [String(v)]
    }
    if (ids.length === 0) {
      throw new Error(
        'Bsale: taxIdIVA no configurado en la conexión. Sin taxId el documento se emite exento, lo cual no está permitido. Configúralo en /billing/setup.',
      )
    }
    return `[${ids.join(',')}]`
  }

  // Si en la conexión está declareSii=false, emitimos en Bsale sin enviar al
  // SII. Útil para sandbox y pruebas iniciales sin gastar folios CAF reales.
  private declareSii(config?: DriverConfig): 0 | 1 {
    const v = config?.declareSii
    if (v === false || v === 0 || v === '0' || v === 'false') return 0
    return 1
  }

  // Resuelve el documentTypeId interno de Bsale a partir del codeSii (que es
  // estándar SII). Bsale exige documentTypeId en POST /returns.json y los IDs
  // son por cuenta. Cacheamos en memoria por instancia del driver.
  private docTypeCache: Map<string, Map<number, number>> = new Map()
  private async resolveDocumentTypeId(
    c: AxiosInstance,
    accessToken: string,
    codeSii: number,
  ): Promise<number> {
    let cache = this.docTypeCache.get(accessToken)
    if (!cache) {
      cache = new Map()
      const res = await c.get('/document_types.json', { params: { limit: 50 } })
      const items: any[] = res.data?.items || []
      for (const t of items) {
        if (t.codeSii != null) cache.set(Number(t.codeSii), Number(t.id))
      }
      this.docTypeCache.set(accessToken, cache)
    }
    const id = cache.get(codeSii)
    if (!id) {
      throw new Error(
        `Bsale: no hay documentTypeId para codeSii=${codeSii} en esta cuenta. Verifica que tengas habilitado el tipo de documento en Bsale.`,
      )
    }
    return id
  }

  // Bsale espera unix timestamp en segundos (GMT).
  private toUnixSeconds(d: Date): number {
    return Math.floor(d.getTime() / 1000)
  }

  // Normaliza RUT chileno y calcula DV si falta. Ejemplos:
  //   "11.111.111-1" → "11111111-1"
  //   "11111111"     → "11111111-1"   (DV calculado, módulo 11)
  //   "774441271"    → "77444127-1"   (último dígito ya era el DV: lo separa)
  //                    o "774441271-K" si el cálculo da K (no este caso).
  // ML a veces manda el RUT sin guion: en ese caso interpretamos el último
  // dígito como DV y validamos. Si no calza, asumimos que falta y lo
  // calculamos.
  private normalizeRut(rut?: string): string | undefined {
    if (!rut) return undefined
    const clean = rut.replace(/[.\s]/g, '').toUpperCase()
    if (!clean) return undefined
    // Si ya viene con guion, respetar.
    if (clean.includes('-')) {
      const [body, dv] = clean.split('-')
      if (!body || !dv) return clean
      return `${body}-${dv}`
    }
    // Sin guion: asumir últimos 1 char es DV solo si es K o dígito.
    // Si el RUT crudo es solo números y el cálculo coincide con el último
    // dígito, lo separamos. Si no coincide, calculamos DV sobre todo el
    // string (asumiendo que el DV faltaba).
    const allDigits = /^\d+$/.test(clean)
    if (allDigits && clean.length >= 2) {
      const body = clean.slice(0, -1)
      const lastChar = clean.slice(-1)
      const dvCalc = this.calcRutDv(body)
      if (dvCalc === lastChar) {
        return `${body}-${dvCalc}`
      }
      // El último dígito no es DV válido → todo el string es body, calcular DV.
      const dvForFull = this.calcRutDv(clean)
      return `${clean}-${dvForFull}`
    }
    // Caso raro: contiene K o no-numéricos sin guion. Asumimos que la última
    // posición es el DV.
    const body = clean.slice(0, -1)
    const dv = clean.slice(-1)
    return `${body}-${dv}`
  }

  // Algoritmo módulo 11 estándar para RUT chileno.
  private calcRutDv(body: string): string {
    let sum = 0
    let factor = 2
    for (let i = body.length - 1; i >= 0; i--) {
      sum += Number(body[i]) * factor
      factor = factor === 7 ? 2 : factor + 1
    }
    const mod = 11 - (sum % 11)
    if (mod === 11) return '0'
    if (mod === 10) return 'K'
    return String(mod)
  }

  // ─── ITaxDocumentEmitter ──────────────────────────────────────────────────

  async testConnection(
    credentials: DriverCredentials,
    config?: DriverConfig,
  ): Promise<BillingConnectionTest> {
    try {
      const c = this.client(credentials)
      // Endpoint barato para validar el token. /offices.json devuelve sucursales.
      const res = await c.get('/offices.json', { params: { limit: 1 } })
      const office = res.data?.items?.[0]

      // Validamos que el taxIdIVA configurado existe en la cuenta. Bsale
      // ignora silenciosamente taxIds inválidos y emite documentos exentos
      // — eso lo descubrimos en la primera prueba productiva. Mejor fallar
      // aquí con mensaje claro.
      const taxIdConfigured = config?.taxIdIVA
      if (taxIdConfigured) {
        try {
          const taxes = await c.get('/taxes.json', { params: { limit: 50 } })
          const items: any[] = taxes.data?.items || []
          const found = items.find((t) => String(t.id) === String(taxIdConfigured))
          if (!found) {
            const available = items
              .filter((t) => /iva/i.test(t.name))
              .map((t) => `id=${t.id} (${t.name} ${t.percentage}%)`)
              .join(', ')
            return {
              success: false,
              error: `taxIdIVA="${taxIdConfigured}" no existe en esta cuenta Bsale. IVAs disponibles: ${available || 'ninguno'}`,
            }
          }
        } catch {
          // Si /taxes.json falla, no bloqueamos el test — el token sirvió
          // al menos para /offices.json.
        }
      }

      return {
        success: true,
        accountName: office?.name,
        officeId: office?.id ? String(office.id) : undefined,
      }
    } catch (err: any) {
      return {
        success: false,
        error: err?.response?.data?.error || err?.message || 'Bsale: connection failed',
      }
    }
  }

  async upsertClient(
    credentials: DriverCredentials,
    config: DriverConfig | undefined,
    client: TaxClientInput,
  ): Promise<UpsertClientResult> {
    const c = this.client(credentials)
    const code = this.normalizeRut(client.rut)

    // Si tenemos RUT, intentar buscar primero. OJO: `GET /clients.json?code=`
    // en Bsale NO filtra estrictamente — la API hace match parcial / fuzzy y
    // puede devolver el primer cliente de la cuenta aunque su `code` no sea
    // el que buscamos. Por eso, validamos que el `code` del cliente devuelto
    // sea EXACTAMENTE igual al RUT normalizado que queremos. Sin esta
    // verificación, todas las boletas a consumidor final terminaban emitidas
    // al primer cliente creado (síntoma: "todas las boletas salieron a nombre
    // de la misma persona").
    if (code) {
      try {
        const search = await c.get('/clients.json', { params: { code, limit: 50 } })
        const items: any[] = search.data?.items || []
        const found = items.find((it) => {
          const itCode = this.normalizeRut(String(it.code || ''))
          return itCode && itCode === code
        })
        if (found?.id) {
          const patch: Record<string, unknown> = {}
          // Si el nombre del cliente cambió, lo actualizamos. Esto cubre el
          // caso histórico donde un cliente quedó creado con nombre genérico
          // y queremos corregirlo con datos reales.
          if (client.firstName && found.firstName !== client.firstName) {
            patch.firstName = client.firstName
          }
          if (client.lastName != null && found.lastName !== client.lastName) {
            patch.lastName = client.lastName
          }
          // Empresa: corregir company/companyOrPerson/activity SIEMPRE que
          // el cliente nuevo sea empresa. Antes solo se seteaban al crear,
          // así que clientes creados antes de tener billingName quedaban
          // como persona física y la factura salía con "firstName lastName"
          // (partido del nombre de la empresa) en vez de razón social.
          if (client.isCompany) {
            if (found.companyOrPerson !== 1) patch.companyOrPerson = 1
            if (client.businessName && found.company !== client.businessName) {
              patch.company = client.businessName
            }
            if (client.economicActivity && found.activity !== client.economicActivity) {
              patch.activity = client.economicActivity
            }
          }
          // Dirección: sobrescribir SIEMPRE que el cliente nuevo traiga
          // datos distintos. Antes solo escribíamos cuando found.X estaba
          // vacío, así que un cliente con dirección vieja mal cargada
          // (ej. comuna="RM Metropolitana") nunca se corregía aunque el
          // sale nuevo trajera la comuna correcta.
          if (client.address && found.address !== client.address) {
            patch.address = client.address
          }
          if (client.city && found.city !== client.city) {
            patch.city = client.city
          }
          const newMuni = client.municipality || client.city
          if (newMuni && found.municipality !== newMuni) {
            patch.municipality = newMuni
          }
          if (!found.email && client.email) patch.email = client.email
          if (!found.phone && client.phone) patch.phone = client.phone
          if (!found.activity && client.economicActivity) {
            patch.activity = client.economicActivity
          }
          if (Object.keys(patch).length > 0) {
            try {
              await c.put(`/clients/${found.id}.json`, patch)
            } catch {
              // Si la actualización falla, igual seguimos con el cliente
              // existente — quizás el documento se rechace, pero al menos
              // intentamos.
            }
          }
          return { externalClientId: String(found.id), created: false }
        }
      } catch {
        // Si la búsqueda falla, seguimos con el create. No es crítico.
      }
    }

    const body: Record<string, unknown> = {
      firstName: client.firstName,
      lastName: client.lastName || '',
    }
    if (code) body.code = code
    if (client.email) body.email = client.email
    if (client.phone) body.phone = client.phone
    if (client.address) body.address = client.address
    if (client.city) body.city = client.city
    // Bsale exige `municipality` para facturas. Si solo tenemos city, la
    // duplicamos como municipality (mejor que dejar el field vacío y que
    // Bsale rechace el documento).
    if (client.municipality || client.city) {
      body.municipality = client.municipality || client.city
    }
    if (client.isCompany) body.companyOrPerson = 1
    if (client.businessName) body.company = client.businessName
    if (client.economicActivity) body.activity = client.economicActivity

    try {
      const res = await c.post('/clients.json', body)
      return { externalClientId: String(res.data.id), created: true }
    } catch (err: any) {
      // 422 con mensaje de duplicado: re-buscar con verificación estricta de
      // code (la API hace match parcial — sin verificar `code` exacto puede
      // devolver un cliente distinto).
      const errorMsg: string = err?.response?.data?.error || ''
      if (code && /already|exist|duplic/i.test(errorMsg)) {
        const search = await c.get('/clients.json', { params: { code, limit: 50 } })
        const items: any[] = search.data?.items || []
        const found = items.find((it) => {
          const itCode = this.normalizeRut(String(it.code || ''))
          return itCode && itCode === code
        })
        if (found?.id) return { externalClientId: String(found.id), created: false }
      }
      throw new Error(`Bsale upsertClient failed: ${errorMsg || err?.message}`)
    }
  }

  async emitDocument(
    credentials: DriverCredentials,
    config: DriverConfig | undefined,
    input: EmitDocumentInput,
  ): Promise<EmitDocumentResult> {
    const c = this.client(credentials)
    const officeId = this.officeId(config)
    const taxIdStr = this.taxIdString(config)
    const codeSii = input.type === 'factura' ? SII_FACTURA : SII_BOLETA

    const { externalClientId } = await this.upsertClient(credentials, config, input.client)

    const emissionTs = this.toUnixSeconds(input.emissionDate)
    const expirationTs = emissionTs

    const details = input.lines.map((l) => ({
      code: l.sku,
      comment: l.name,
      netUnitValue: l.netUnitValue.toFixed(2),
      quantity: l.quantity.toFixed(3),
      // Sí, Bsale REALMENTE espera el array como string "[1]". Si se envía
      // como array JS, Bsale lo descarta y el documento sale exento.
      taxId: taxIdStr,
      discount: l.discountPct ?? 0,
    }))

    const body: Record<string, unknown> = {
      codeSii,
      officeId,
      emissionDate: emissionTs,
      expirationDate: expirationTs,
      declareSii: this.declareSii(config),
      clientId: Number(externalClientId),
      details,
    }

    // references[] en Bsale: convertimos cada DocumentReference al shape que
    // exige la API. codeSii=801 es "orden de compra" en la tabla oficial del
    // SII chileno (tabla TpoDocRef). Si la referencia no especifica
    // codeSii, asumimos 801.
    if (input.references && input.references.length > 0) {
      body.references = input.references.map((ref) => {
        const refDate = ref.date ? this.toUnixSeconds(ref.date) : emissionTs
        return {
          number: ref.number,
          reason: ref.reason || 'Orden de compra',
          codeSii: ref.codeSii ?? 801,
          referenceDate: refDate,
        }
      })
    }

    try {
      const res = await c.post('/documents.json', body)
      const data = res.data || {}
      const docId = String(data.id)

      // POST /documents.json devuelve `details` como `{ href }` (lazy ref) y
      // NO incluye los IDs de las líneas. Tenemos que hacer un GET extra al
      // endpoint de details para obtenerlos. Los necesitamos para emitir NC
      // posteriormente (el driver usa documentDetailId al revertir líneas).
      let externalLineIds: string[] = []
      try {
        const detailsRes = await c.get(`/documents/${docId}/details.json`, {
          params: { limit: Math.max(50, input.lines.length) },
        })
        const items: any[] = detailsRes.data?.items || []
        // Ordenar por lineNumber para asegurar mismo orden que enviamos.
        items.sort((a, b) => (a.lineNumber ?? 0) - (b.lineNumber ?? 0))
        externalLineIds = items.map((it) => String(it.id))
      } catch {
        // Si falla el fetch, dejamos vacío. La NC posterior fallará pero el
        // documento principal está emitido — mejor que abortar todo.
      }

      return {
        externalId: docId,
        folio: data.number != null ? String(data.number) : undefined,
        emittedAt: data.emissionDate ? new Date(Number(data.emissionDate) * 1000) : input.emissionDate,
        pdfUrl: data.urlPdf || data.urlPdfOriginal || undefined,
        xmlUrl: data.urlXml || undefined,
        externalLineIds,
        rawResponse: data,
      }
    } catch (err: any) {
      const errorMsg = err?.response?.data?.error || err?.message
      throw new Error(`Bsale emitDocument failed: ${errorMsg}`)
    }
  }

  async emitCreditNote(
    credentials: DriverCredentials,
    config: DriverConfig | undefined,
    input: EmitCreditNoteInput,
  ): Promise<EmitDocumentResult> {
    const c = this.client(credentials)
    const officeId = this.officeId(config)
    const emissionTs = this.toUnixSeconds(input.emissionDate)

    // Bsale exige documentTypeId (NO codeSii) en /returns.json. El ID es
    // interno por cuenta — resolvemos a partir del codeSii estándar SII (61).
    const documentTypeId = await this.resolveDocumentTypeId(
      c,
      credentials.accessToken,
      SII_NOTA_CREDITO,
    )

    // Bsale exige que el cliente del documento original tenga `code` (RUT)
    // para emitir NC. Boletas a consumidor final se emiten sin RUT, y la
    // NC posterior falla con "client attributes required: code". Aquí
    // verificamos y, si falta, le ponemos el RUT genérico SII (66.666.666-6).
    try {
      const docRes = await c.get(`/documents/${input.originalExternalId}.json`)
      const clientHref = docRes.data?.client?.href
      if (clientHref) {
        const clientRes = await c.get(clientHref)
        const cli = clientRes.data
        if (cli?.id && !cli.code) {
          await c.put(`/clients/${cli.id}.json`, { code: '66666666-6' })
        }
      }
    } catch {
      // Si la inspección/patch del cliente falla, igual seguimos —
      // Bsale dará error claro abajo si realmente bloquea.
    }

    // Política del sistema: NC siempre totales. Bsale espera la cantidad
    // ORIGINAL de la línea — NO 0, contrario a lo que sugiere la doc. La
    // devolución "total" en Bsale = devolver toda la cantidad de la línea
    // referenciada. No se manda unitValue (lo toma del documento original).
    const details = input.originalLines.map((l) => ({
      documentDetailId: Number(l.externalLineId),
      quantity: l.quantity,
    }))

    const body: Record<string, unknown> = {
      documentTypeId,
      officeId,
      referenceDocumentId: Number(input.originalExternalId),
      emissionDate: emissionTs,
      expirationDate: emissionTs,
      motive: input.motive,
      declareSii: this.declareSii(config),
      type: 0, // 0 = reembolso en efectivo
      details,
    }

    try {
      const res = await c.post('/returns.json', body)
      const data = res.data || {}
      const creditNote = data.credit_note || data.creditNote || {}
      const ncId = String(creditNote.id || data.id)

      return {
        externalId: ncId,
        emittedAt: data.returnDate
          ? new Date(Number(data.returnDate) * 1000)
          : input.emissionDate,
        pdfUrl: creditNote.urlPdf || undefined,
        xmlUrl: creditNote.urlXml || undefined,
        rawResponse: data,
      }
    } catch (err: any) {
      const errorMsg = err?.response?.data?.error || err?.message
      throw new Error(`Bsale emitCreditNote failed: ${errorMsg}`)
    }
  }

  async getPdfUrl(
    credentials: DriverCredentials,
    config: DriverConfig | undefined,
    externalId: string,
  ): Promise<string> {
    // Bsale expone el PDF en la respuesta de creación (`urlPdf`). Si necesitamos
    // re-resolverlo, GET /documents/{id}.json devuelve el mismo campo.
    const c = this.client(credentials)
    const res = await c.get(`/documents/${externalId}.json`)
    const url = res.data?.urlPdf || res.data?.urlPdfOriginal
    if (!url) throw new Error(`Bsale: documento ${externalId} no tiene PDF disponible`)
    return url
  }

  async getXmlUrl(
    credentials: DriverCredentials,
    config: DriverConfig | undefined,
    externalId: string,
  ): Promise<string> {
    const c = this.client(credentials)
    const res = await c.get(`/documents/${externalId}.json`)
    const url = res.data?.urlXml
    if (!url) throw new Error(`Bsale: documento ${externalId} no tiene XML disponible`)
    return url
  }
}
