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

  private taxIds(config?: DriverConfig): string[] {
    const v = config?.taxIdIVA
    if (Array.isArray(v) && v.length > 0) return v.map(String).filter(Boolean)
    if (typeof v === 'string' && v.length > 0) return [v]
    if (typeof v === 'number') return [String(v)]
    throw new Error(
      'Bsale: taxIdIVA no configurado en la conexión. Sin taxId el documento se emite exento, lo cual no está permitido. Configúralo en /billing/setup.',
    )
  }

  // Si en la conexión está declareSii=false, emitimos en Bsale sin enviar al
  // SII. Útil para sandbox y pruebas iniciales sin gastar folios CAF reales.
  private declareSii(config?: DriverConfig): 0 | 1 {
    const v = config?.declareSii
    if (v === false || v === 0 || v === '0' || v === 'false') return 0
    return 1
  }

  // Bsale espera unix timestamp en segundos (GMT).
  private toUnixSeconds(d: Date): number {
    return Math.floor(d.getTime() / 1000)
  }

  // Normaliza RUT chileno: quita puntos y espacios, mantiene guion y dígito
  // verificador. "11.111.111-1" → "11111111-1".
  private normalizeRut(rut?: string): string | undefined {
    if (!rut) return undefined
    return rut.replace(/\./g, '').replace(/\s+/g, '').toUpperCase()
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

    // Si tenemos RUT, intentar buscar primero. Bsale no documenta GET por code,
    // pero la API real soporta `?code=<rut>` como filtro.
    if (code) {
      try {
        const search = await c.get('/clients.json', { params: { code, limit: 1 } })
        const found = search.data?.items?.[0]
        if (found?.id) {
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
    if (client.isCompany) body.companyOrPerson = 1
    if (client.businessName) body.company = client.businessName
    if (client.economicActivity) body.activity = client.economicActivity

    try {
      const res = await c.post('/clients.json', body)
      return { externalClientId: String(res.data.id), created: true }
    } catch (err: any) {
      // 422 con mensaje de duplicado: re-buscar.
      const errorMsg: string = err?.response?.data?.error || ''
      if (code && /already|exist|duplic/i.test(errorMsg)) {
        const search = await c.get('/clients.json', { params: { code, limit: 1 } })
        const found = search.data?.items?.[0]
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
    const taxIds = this.taxIds(config)
    const codeSii = input.type === 'factura' ? SII_FACTURA : SII_BOLETA

    const { externalClientId } = await this.upsertClient(credentials, config, input.client)

    const emissionTs = this.toUnixSeconds(input.emissionDate)
    const expirationTs = emissionTs

    const details = input.lines.map((l) => ({
      code: l.sku,
      comment: l.name,
      netUnitValue: l.netUnitValue.toFixed(2),
      quantity: l.quantity.toFixed(3),
      taxId: taxIds,
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

    if (input.externalReference?.number) {
      body.references = [
        {
          number: input.externalReference.number,
          reason: input.externalReference.reason || 'Orden de compra marketplace',
        },
      ]
    }

    try {
      const res = await c.post('/documents.json', body)
      const data = res.data || {}

      // Las líneas devuelven sus IDs en el mismo orden que el array `details`
      // que enviamos. Bsale las expone como `details` (objeto con `items`) o
      // `details` array según versión; manejamos ambos.
      const detailsResp = data.details
      const items: any[] = Array.isArray(detailsResp)
        ? detailsResp
        : detailsResp?.items || []
      const externalLineIds = items.map((it) => String(it.id))

      return {
        externalId: String(data.id),
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

    // Política del sistema: NC siempre totales. En Bsale eso se expresa con
    // quantity=0 y unitValue=0 por línea → revierte la línea completa.
    const details = input.originalLines.map((l) => ({
      documentDetailId: Number(l.externalLineId),
      quantity: '0',
      unitValue: '0',
    }))

    const body: Record<string, unknown> = {
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
