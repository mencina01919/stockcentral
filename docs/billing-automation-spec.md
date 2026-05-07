# Facturación electrónica automática — Spec técnica

Última actualización: 2026-05-07. Owner: equipo StockCentral.

## Contrato funcional

1. **El portal nunca escribe el `status` del marketplace.** Lo que llega del marketplace solo se observa y se traduce a un `internalStatus`.
2. **Estados internos avanzan automáticamente** desde webhook (cuando exista) o sync periódico. Sin botones manuales.
3. **Emisión automática al pagar**:
   - `paymentStatus` pasa a `paid` → emitir documento.
   - Si `invoiceType === 'factura'` y faltan datos de billing → esperar hasta 24 h. Si timeout → emitir boleta.
4. **NC automática** si la orden se cancela **después** de emitido el documento. Si se cancela antes, no se hace nada.
5. **NC siempre totales** (no parciales).
6. **Multi-emisor desde el día 1**: interfaz `TaxDocumentEmitter`, primer driver Bsale.
7. **Bsale por tenant** (Connection con `provider='bsale'`). `officeId` configurable, vacío por defecto.
8. **No sincronizamos inventario con Bsale**. Las líneas del documento van como glosa (`code`/`comment` + `netUnitValue` + `quantity`).
9. **El número de orden del marketplace** se envía como referencia ("orden de compra") en el documento Bsale.

## Hallazgos por marketplace

Mapeo de los drivers actuales en `packages/integrations/src/drivers/*`:

### MercadoLibre — el más completo

- Status raw que se ve en el código: `paid`, `confirmed`, `shipped`, `delivered`, `cancelled`, `payment_required`, `payment_in_process`, `partially_refunded`. Vienen del field `status` en `/orders/{id}`.
- **Billing**: hidrata vía endpoint extra `/orders/{id}/billing_info`. Llena `name`, `docType`, `docNumber`, `email`, `phone`, `economicActivity`, `taxContributor`.
- Detecta factura vs boleta: si llega `BUSINESS_NAME` o `ECONOMIC_ACTIVITY` en `additional_info` → `invoiceType='factura'`.
- **`externalOrderNumber`**: `String(data.id)` ([mercadolibre.driver.ts:504](../packages/integrations/src/drivers/mercadolibre.driver.ts#L504)).
- Webhooks nativos disponibles en ML (notifications API), pero **no están conectados** a un endpoint de StockCentral todavía.

### Falabella — pobre

- Status raw: `header.Statuses.Status` desde XML (puede ser string o array). Valores: `pending`, `ready_to_ship`/`readytoship`, `shipped`, `delivered`, `canceled`, `failed`, `returned`.
- **Billing**: solo `name`, `email`, `phone` desde `AddressBilling`. Sin RUT, sin invoiceType, sin actividad.
- **Conclusión**: con Falabella **siempre se emitirá boleta**. No hay forma de saber si el cliente quería factura.
- **`externalOrderNumber`**: `String(header.OrderNumber || header.OrderId)`.
- Sin webhooks integrados.

### Paris — billing parcial pero discrimina factura

- Status raw mapeado: `awaiting_fullfillment` → pending, `ready_to_ship` → confirmed, `shipped` → fulfilled, `delivered` → completed, `cancelled` → cancelled.
- **Billing**: llena `name`, `docType`, `docNumber`, `invoiceType`. `invoiceType='factura'` cuando `data.businessInvoice !== 'boleta'`.
- Sin email/teléfono/actividad económica.
- **`externalOrderNumber`**: `String(data.originOrderNumber || data.id)`.
- Sin webhooks integrados.

### Lider — no soporta factura

- Status raw agregado de `data.orderLines.orderLine[]`: `Created`, `Acknowledged`, `Shipped`, `Cancelled`.
- **Billing**: solo `invoiceType: 'boleta'` hardcoded. Walmart no expone datos fiscales del comprador.
- **`externalOrderNumber`**: `String(data.customerOrderId || data.purchaseOrderId)`.
- Sin webhooks integrados.

### Tabla resumen

| Driver | Detecta factura | RUT | Email/Tel | Giro | Order# externo |
|---|---|---|---|---|---|
| ML | ✅ vía billing_info | ✅ | ✅ | ✅ | `data.id` |
| Falabella | ❌ siempre boleta | ❌ | ✅ | ❌ | `OrderNumber\|OrderId` |
| Paris | ✅ vía businessInvoice | ✅ | ❌ | ❌ | `originOrderNumber\|id` |
| Lider | ❌ siempre boleta | ❌ | ❌ | ❌ | `customerOrderId\|purchaseOrderId` |

## Mapeo de estados marketplace → interno

Hoy `sync.service.ts` ya tiene `mapMarketplaceOrderStatus`, `mapPaymentStatus`, `mapShipmentStatus`. **El mapping de `paymentStatus` ya considera "paid" cuando** el status raw es `paid`, `delivered`, `shipped`, `ready_to_ship`, `partially_refunded` ([sync.service.ts:727-734](../apps/api/src/modules/sync/sync.service.ts#L727-L734)).

Para el flujo automático debemos **escuchar el cambio** `paymentStatus pending → paid` y disparar emisión. Recomendación: agregar un hook en `sync.service.ts` que, después del `prisma.order.update`, compare el valor previo y dispare un evento interno (event emitter o bull job).

Mapeo de `internalStatus` que faltan agregar:

| `marketStatus` raw | `internalStatus` propuesto |
|---|---|
| pending, payment_required, payment_in_process | `new` |
| paid, confirmed, ready_to_ship, acknowledged | `in_preparation` |
| shipped, fulfilled, delivered, completed | `ready_to_ship` (estado terminal en sistema) |
| cancelled, canceled, failed, returned | `cancelled_internal` |

## Bsale — endpoints confirmados

Documentación oficial: https://apichile.bsalelab.com/lista-de-endpoints/

### Auth

Header. La doc no es 100% explícita entre `Authorization: Bearer <token>` y `access_token: <token>`. Probar primero `access_token` ya que la API original lo usa así, fallback a Bearer.

### `POST /v1/documents.json` — emite DTE

```jsonc
{
  "codeSii": 39,                        // 33=factura, 39=boleta, 61=NC
  "officeId": 1,                        // configurable por tenant
  "emissionDate": 1714435200,           // unix timestamp GMT
  "expirationDate": 1714435200,
  "declareSii": 1,
  "clientId": 12345,                    // si ya existe
  // O alternativamente client inline:
  "client": { "code": "11.111.111-1", "firstName": "Juan", "lastName": "Perez" },
  "details": [
    {
      "code": "SKU-INTERNO",            // glosa (no resolvemos contra Bsale)
      "comment": "Nombre producto + variante",
      "netUnitValue": "1000.00",
      "quantity": "2",
      "taxId": ["14"],                  // 14 = IVA. Si se omite, sale exento
      "discount": 0
    }
  ],
  "references": [                       // ← AQUÍ va el número de orden ML/Paris/etc
    {
      "number": "ORDEN-EXTERNA-12345",
      "documentTypeId": 1,              // o el typeId de "orden de compra" según config
      "reason": "Orden de compra marketplace"
    }
  ]
}
```

Respuesta (201): `{ id, emissionDate, generationDate, ... }`. PDF en `GET /v1/documents/{id}/pdf`, XML en `/xml`.

**Importante**: si no llega `taxId`, el DTE sale **exento** y el SII puede rechazarlo. Hardcodear `taxId: ["14"]` para CL.

### `POST /v1/clients.json` — crea cliente

```jsonc
{
  "firstName": "Juan",
  "lastName": "Perez",
  "code": "11.111.111-1",   // RUT — único, sirve como dedup
  "email": "...",
  "phone": "..."
}
```

No hay `GET /v1/clients.json?code=...` documentado. **Estrategia**: intentar `POST` siempre; si Bsale devuelve "ya existe", parsear el ID del error o iterar `GET /v1/clients.json` con paginación filtrando localmente. **Mejor**: cachear `rut → bsaleClientId` en una tabla local `BsaleClientCache(tenantId, rut, externalClientId)`.

### `POST /v1/returns.json` — devolución → genera NC automáticamente

```jsonc
{
  "documentTypeId": "<id de NC>",
  "officeId": 1,
  "referenceDocumentId": 99999,    // id del documento original (boleta/factura)
  "emissionDate": 1714435200,
  "expirationDate": 1714435200,
  "motive": "Cancelación de la orden marketplace",
  "declareSii": 1,
  "type": 0,                       // 0=reembolso efectivo
  "details": [
    { "documentDetailId": "<id linea original>", "quantity": "0", "unitValue": "0" }
    // quantity=0 + unitValue=0 = devolución total de la línea
  ]
}
```

Respuesta: `{ id, credit_note: { id }, code, amount, returnDate }`. **La NC se genera sola, no requiere POST extra a `/documents.json`**.

Para NC total: hay que enviar todas las líneas del documento original. Eso obliga a guardar `documentDetailId` por cada línea cuando emitimos la boleta/factura.

## Modelo de datos propuesto

### `TaxDocument`

```prisma
model TaxDocument {
  id        String   @id @default(uuid())
  tenantId  String
  saleId    String?  // o orderId si emitimos por orden, no venta
  orderId   String?

  type        String   // boleta | factura | nota_credito
  status      String   @default("pending")  // pending | issued | failed | cancelled
  emitter     String   @default("bsale")

  externalId  String?  // bsale documents.id
  folio       String?
  emittedAt   DateTime?

  pdfUrl      String?
  xmlUrl      String?

  // Para NC: apunta al doc original ya emitido
  referenceDocumentId String?
  reference   TaxDocument?  @relation("TaxDocRefs", fields: [referenceDocumentId], references: [id])
  creditNotes TaxDocument[] @relation("TaxDocRefs")

  // Líneas (necesarias para emitir NC total)
  lines       TaxDocumentLine[]

  // Errores y reintentos
  lastError   String?
  attempts    Int      @default(0)

  // Datos snapshot al momento de emisión (por si la sale cambia después)
  snapshot    Json?

  metadata    Json?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  sale   Sale?  @relation(fields: [saleId], references: [id], onDelete: SetNull)
  order  Order? @relation(fields: [orderId], references: [id], onDelete: SetNull)

  @@index([tenantId, status])
  @@index([tenantId, saleId])
  @@index([tenantId, orderId])
  @@index([externalId])
}

model TaxDocumentLine {
  id              String  @id @default(uuid())
  taxDocumentId   String
  externalLineId  String? // documentDetailId de Bsale (necesario para NC)
  sku             String
  name            String
  quantity        Decimal @db.Decimal(12, 3)
  netUnitValue    Decimal @db.Decimal(12, 2)
  taxIds          String[]
  discount        Decimal @default(0) @db.Decimal(5, 2)

  document TaxDocument @relation(fields: [taxDocumentId], references: [id], onDelete: Cascade)

  @@index([taxDocumentId])
}
```

### Conexión Bsale

Reutilizamos `Connection` con `provider='bsale'`. Credentials: `{ accessToken }`. Config: `{ officeId, priceListId?, taxIdIVA: '14', defaultExpirationDays?: 0 }`.

## Capa de abstracción multi-emisor

```ts
// packages/integrations/src/types/billing.ts
export interface TaxDocumentEmitter {
  provider: 'bsale' | 'haulmer' | 'openfactura' | string

  testConnection(creds: DriverCredentials, config?: DriverConfig): Promise<{ success: boolean; error?: string }>

  emitDocument(
    creds: DriverCredentials,
    config: DriverConfig,
    input: EmitDocumentInput,
  ): Promise<EmitDocumentResult>

  emitCreditNote(
    creds: DriverCredentials,
    config: DriverConfig,
    input: EmitCreditNoteInput,
  ): Promise<EmitDocumentResult>

  getPdfUrl(creds, config, externalId): Promise<string>
  getXmlUrl?(creds, config, externalId): Promise<string>

  upsertClient?(creds, config, client: ClientInput): Promise<{ externalClientId: string }>
}

export interface EmitDocumentInput {
  type: 'boleta' | 'factura'
  emissionDate: Date
  client: ClientInput
  lines: Array<{
    sku: string
    name: string
    quantity: number
    netUnitValue: number
    discountPct?: number
  }>
  // Aquí se llena con el orderNumber externo del marketplace
  externalReference?: { number: string; reason?: string }
}

export interface EmitDocumentResult {
  externalId: string
  folio?: string
  emittedAt: Date
  pdfUrl?: string
  xmlUrl?: string
  externalLineIds?: string[]
}
```

## Listener interno — disparo automático

```ts
// apps/api/src/modules/billing/billing.listener.ts
@Injectable()
export class BillingListener {
  // Llamado por sync.service y por webhooks inbound (cuando existan)
  async onOrderUpdated(prev: Order, next: Order) {
    if (prev.paymentStatus !== 'paid' && next.paymentStatus === 'paid') {
      await this.queueEmit(next.saleId)  // bull job
    }
    if (prev.internalStatus !== 'cancelled_internal' && next.internalStatus === 'cancelled_internal') {
      const existing = await this.findEmittedDoc(next.saleId)
      if (existing) await this.queueCreditNote(existing.id)
    }
  }
}
```

Reglas del job de emisión:
1. Si `invoiceType === 'factura'` y faltan datos críticos (`billingDocNumber`, `billingName`) → reintentar en 1 h, hasta 24 h. Pasadas 24 h → degradar a boleta y emitir.
2. Idempotencia: chequear que no exista `TaxDocument` con `saleId` + `status='issued'` antes de emitir.
3. Reintentos: hasta 5 con backoff exponencial. Tras 5 fallos → status `failed` y operador puede reintentar manualmente desde UI.

## UI propuesta

Nuevo tab dentro de Facturación: **Documentos emitidos**.

Listado con: tipo, folio, sale#, cliente, monto, estado, fecha emisión, links PDF/XML.

Acciones:
- **Reintentar emisión** (solo si `status='failed'`).
- **Subir manualmente** (para casos legacy o cuando Bsale falló y se emitió por otra vía).
- **Ver detalle** (líneas, errores, snapshot).

## Plan de fases

| Fase | Descripción | Ya hecho |
|---|---|---|
| 1 | Portal solo-lectura sobre estados | ✅ |
| 2 | Investigación documentada | ✅ (este doc) |
| 3 | Modelo `TaxDocument` + migración Prisma | pendiente |
| 4 | Interfaz `TaxDocumentEmitter` + driver Bsale + endpoint manual | pendiente |
| 5 | Listener auto-emisión + jobs con reintento + timeout 24 h | pendiente |
| 6 | Mapeo automático estados marketplace → `internalStatus` | pendiente |
| 7 | UI Documentos + upload manual + reintento | pendiente |

## Cabos sueltos / decisiones a tomar luego

1. **Webhooks inbound**: hoy ML/Falabella/Paris no notifican a StockCentral. Mientras tanto, el sync periódico dispara los cambios. Si se quiere reducir latencia, hay que crear endpoints `/webhooks/in/:provider` con verificación de firma.
2. **Multi-tenant Bsale**: cada tenant tendrá su token. Almacenar en `Connection.credentials` (ya cifrado por la infra existente).
3. **`taxId` por país**: Chile = `["14"]` (IVA 19%). Si más adelante se factura desde Bsale Perú/Colombia/Argentina, será configurable por conexión.
4. **Conversión boleta → factura**: si el cliente pide factura después de emitida la boleta, hay que: (a) emitir NC sobre la boleta, (b) emitir factura nueva. Hoy no hay UI para esto. Decisión: dejarlo para fase ulterior.
5. **`documentTypeId` específico para "orden de compra"** dentro de `references[]`: la doc Bsale no es del todo clara — habrá que leerlo desde la cuenta real del cliente al primer setup.
