// Auditoría: compara qué órdenes ML tienen DTE adjunto en ML vs lo que
// tenemos registrado en local (TaxDocument.metadata.marketplaceUpload).
//
// Reporta:
//   - Órdenes con DTE en ML
//   - Órdenes con DTE en ML pero sin TaxDocument issued en local
//     (caso típico: emitido fuera del sistema en el panel ML, o NC manual)
//   - Órdenes con TaxDocument issued en local pero sin DTE en ML
//     (caso: pushToMarketplace no se ejecutó)
//   - Órdenes sin DTE en ningún lado
//
// Uso: ts-node audit-ml-fiscal-docs.ts [days]
//   days: cuántos días hacia atrás revisar. Si se omite o es 0, audita TODAS
//   las órdenes ML (sin filtro de fecha). Hacerlo "todas" toma varios
//   minutos en cuentas con miles de órdenes.

import { PrismaClient } from '@prisma/client'
import axios from 'axios'

// 0 = todas
const DAYS = Number(process.argv[2] ?? 0)

interface MLFiscalDoc {
  id: string
  filename: string
  date: string
  file_type: string
}

async function run() {
  const prisma = new PrismaClient()
  const conn = await prisma.connection.findFirst({ where: { provider: 'mercadolibre' } })
  if (!conn) { console.log('NO_ML_CONN'); process.exit(1) }
  const token = (conn.credentials as any).accessToken
  const c = axios.create({
    baseURL: 'https://api.mercadolibre.com',
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15000,
  })

  const where: any = { source: 'mercadolibre' }
  if (DAYS > 0) {
    const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000)
    where.placedAt = { gte: since }
  }
  const orders = await prisma.order.findMany({
    where,
    include: {
      sale: {
        include: {
          taxDocuments: {
            where: { type: { in: ['boleta', 'factura'] }, status: 'issued' },
            select: { id: true, type: true, folio: true, metadata: true },
          },
        },
      },
    },
    orderBy: { placedAt: 'desc' },
  })

  const scope = DAYS > 0 ? `últimos ${DAYS} días` : 'TODAS (sin filtro de fecha)'
  console.log(`Auditando ${orders.length} órdenes ML — ${scope}...\n`)

  const inMlOnly: Array<{ orderId: string; folios: string[] }> = []
  const inLocalOnly: Array<{ orderId: string; saleNumber: string; folios: string[] }> = []
  const both: number[] = []
  const neither: Array<{ orderId: string; saleNumber: string; total: any }> = []

  let i = 0
  for (const order of orders) {
    i++
    const packOrOrderId = order.packId || order.externalOrderId
    if (!packOrOrderId) continue

    let mlDocs: MLFiscalDoc[] = []
    try {
      const res = await c.get(`/packs/${packOrOrderId}/fiscal_documents`)
      mlDocs = res.data?.fiscal_documents || []
    } catch (err: any) {
      if (err?.response?.status === 400 || err?.response?.status === 404) {
        // ML responde 400/404 cuando no hay docs adjuntos. Tratamos como vacío.
        mlDocs = []
      } else {
        console.log(`  ${packOrOrderId}: ERROR ${err?.response?.status}`)
        continue
      }
    }

    const localDocs = order.sale?.taxDocuments || []
    const localFolios = localDocs.map((d) => d.folio).filter(Boolean) as string[]
    const mlFolios = mlDocs.map((d) => d.filename.replace(/\.pdf$/i, ''))

    if (mlDocs.length > 0 && localDocs.length === 0) {
      inMlOnly.push({ orderId: String(packOrOrderId), folios: mlFolios })
    } else if (mlDocs.length === 0 && localDocs.length > 0) {
      inLocalOnly.push({
        orderId: String(packOrOrderId),
        saleNumber: order.sale?.saleNumber || '?',
        folios: localFolios,
      })
    } else if (mlDocs.length > 0 && localDocs.length > 0) {
      both.push(1)
    } else {
      neither.push({
        orderId: String(packOrOrderId),
        saleNumber: order.sale?.saleNumber || '?',
        total: order.total,
      })
    }

    if (i % 50 === 0) console.log(`  procesados ${i}/${orders.length}`)
    // Rate limit Bsale-style: pausa pequeña.
    await new Promise((r) => setTimeout(r, 100))
  }

  console.log('\n===== RESULTADO =====')
  console.log(`Total auditadas:                  ${orders.length}`)
  console.log(`✅ Con DTE en local Y en ML:      ${both.length}`)
  console.log(`⚠️  Solo en ML (no en local):     ${inMlOnly.length}`)
  console.log(`⚠️  Solo en local (no subidas a ML): ${inLocalOnly.length}`)
  console.log(`❌ Sin DTE en ningún lado:        ${neither.length}`)

  if (inLocalOnly.length > 0) {
    console.log('\n--- Detalle: emitidas localmente pero sin subir a ML ---')
    for (const r of inLocalOnly.slice(0, 20)) {
      console.log(`  ${r.saleNumber}  order=${r.orderId}  folios=${r.folios.join(',')}`)
    }
    if (inLocalOnly.length > 20) console.log(`  ... y ${inLocalOnly.length - 20} más`)
  }

  if (inMlOnly.length > 0) {
    console.log('\n--- Detalle: en ML pero no en local (emitidas fuera del sistema) ---')
    for (const r of inMlOnly.slice(0, 20)) {
      console.log(`  order=${r.orderId}  ML folios=${r.folios.join(',')}`)
    }
    if (inMlOnly.length > 20) console.log(`  ... y ${inMlOnly.length - 20} más`)
  }

  if (neither.length > 0) {
    console.log('\n--- Detalle: pagadas SIN factura/boleta en ningún lado ---')
    for (const r of neither.slice(0, 20)) {
      console.log(`  ${r.saleNumber}  order=${r.orderId}  total=${r.total}`)
    }
    if (neither.length > 20) console.log(`  ... y ${neither.length - 20} más`)
  }

  await prisma.$disconnect()
}
run().catch((e) => { console.error(e?.response?.data || e?.message); process.exit(1) })
