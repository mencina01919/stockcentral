// Tipos compartidos para emisores de documentos tributarios.
// Multi-emisor: cada provider (bsale, haulmer, openfactura, ...) implementa
// `TaxDocumentEmitter`. La capa superior es agnóstica al emisor.

import type { DriverCredentials, DriverConfig } from './index'

export type TaxDocumentType = 'boleta' | 'factura' | 'nota_credito'

export interface TaxClientInput {
  // RUT en formato chileno con puntos y guion (e.g. "11.111.111-1") o sin
  // puntos. El driver lo normaliza si es necesario.
  rut?: string
  firstName: string
  lastName?: string
  email?: string
  phone?: string
  // Solo para factura: razón social y giro.
  businessName?: string
  economicActivity?: string
  address?: string
  city?: string
  isCompany?: boolean
}

export interface TaxDocumentLineInput {
  sku: string
  name: string
  quantity: number
  // Valor neto unitario (sin IVA). El driver agrega impuestos vía taxIds.
  netUnitValue: number
  // Descuento en %. 0 si no aplica.
  discountPct?: number
}

export interface EmitDocumentInput {
  type: Exclude<TaxDocumentType, 'nota_credito'>
  emissionDate: Date
  client: TaxClientInput
  lines: TaxDocumentLineInput[]
  // Número de orden externo del marketplace (ML, Falabella, etc.). Va como
  // referencia / "orden de compra" en el documento emitido.
  externalReference?: { number: string; reason?: string }
  currency?: string
}

export interface EmitCreditNoteInput {
  // ID interno de StockCentral del documento original. El driver es responsable
  // de mapearlo a su externalId con el snapshot.
  originalExternalId: string
  // Líneas del documento original. Política del sistema: NC siempre totales,
  // cada driver revierte todas las líneas del documento referenciado.
  originalLines: Array<{
    externalLineId: string
    quantity: number
    netUnitValue: number
  }>
  emissionDate: Date
  motive: string
}

export interface EmitDocumentResult {
  externalId: string
  folio?: string
  emittedAt: Date
  pdfUrl?: string
  xmlUrl?: string
  // documentDetailId de cada línea, en el mismo orden que el input.
  // Necesarios para emitir NC posteriormente.
  externalLineIds?: string[]
  rawResponse?: unknown
}

export interface UpsertClientResult {
  externalClientId: string
  created: boolean
}

export interface BillingConnectionTest {
  success: boolean
  error?: string
  // Datos opcionales para mostrar en UI tras un test exitoso.
  accountName?: string
  officeId?: string
}

export interface ITaxDocumentEmitter {
  provider: string

  testConnection(
    credentials: DriverCredentials,
    config?: DriverConfig,
  ): Promise<BillingConnectionTest>

  // Crea o recupera el cliente en el emisor. Devuelve el id del cliente.
  upsertClient(
    credentials: DriverCredentials,
    config: DriverConfig | undefined,
    client: TaxClientInput,
  ): Promise<UpsertClientResult>

  emitDocument(
    credentials: DriverCredentials,
    config: DriverConfig | undefined,
    input: EmitDocumentInput,
  ): Promise<EmitDocumentResult>

  emitCreditNote(
    credentials: DriverCredentials,
    config: DriverConfig | undefined,
    input: EmitCreditNoteInput,
  ): Promise<EmitDocumentResult>

  getPdfUrl(
    credentials: DriverCredentials,
    config: DriverConfig | undefined,
    externalId: string,
  ): Promise<string>

  getXmlUrl?(
    credentials: DriverCredentials,
    config: DriverConfig | undefined,
    externalId: string,
  ): Promise<string>
}
