// Importa los DTE que ML tiene adjuntos para órdenes que NO tienen
// TaxDocument issued en local. Crea un TaxDocument con emitter='ml-external'
// para distinguirlos de los emitidos por StockCentral.
//
// Útil para reflejar en /billing/documents los documentos que se emitieron
// fuera del sistema (panel ML, integración previa, etc.).
//
// Uso: ts-node import-ml-fiscal-docs.ts [days]
//   days: 0 = todas, default 0.

import { PrismaClient } from '@prisma/client'
import axios from 'axios'

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

  // Solo órdenes pagadas que NO tienen ya un TaxDocument registrado para
  // su sale.
  const orders = await prisma.order.findMany({
    where: {
      ...where,
      sale: {
        taxDocuments: {
          none: { type: { in: ['boleta', 'factura'] }, status: { in: ['issued', 'pending'] } },
        },
      },
    },
    select: {
      id: true,
      tenantId: true,
      packId: true,
      externalOrderId: true,
      saleId: true,
      sale: { select: { saleNumber: true } },
    },
    orderBy: { placedAt: 'desc' },
  })

  console.log(`Revisando ${orders.length} órdenes ML sin TaxDocument local...\n`)

  let imported = 0
  let mlEmpty = 0
  let errors = 0
  let i = 0

  for (const order of orders) {
    i++
    const packOrOrderId = order.packId || order.externalOrderId
    if (!packOrOrderId || !order.saleId) continue

    let mlDocs: MLFiscalDoc[] = []
    try {
      const res = await c.get(`/packs/${packOrOrderId}/fiscal_documents`)
      mlDocs = res.data?.fiscal_documents || []
    } catch (err: any) {
      const status = err?.response?.status
      if (status === 400 || status === 404) {
        mlEmpty++
      } else {
        errors++
      }
      continue
    }

    if (mlDocs.length === 0) {
      mlEmpty++
      continue
    }

    // Tomamos el primer PDF como documento principal. Si hay más, dejamos
    // referencia en metadata.
    const pdfDoc = mlDocs.find((d) => /pdf/i.test(d.file_type)) || mlDocs[0]
    const folio = pdfDoc.filename.replace(/\.pdf$/i, '')

    // Idempotencia: si ya importamos este pdfDoc.id, skip.
    const existing = await prisma.taxDocument.findFirst({
      where: {
        tenantId: order.tenantId,
        emitter: 'ml-external',
        externalId: pdfDoc.id,
      },
    })
    if (existing) continue

    await prisma.taxDocument.create({
      data: {
        tenantId: order.tenantId,
        saleId: order.saleId,
        type: 'boleta', // No sabemos si es boleta o factura desde ML; default boleta.
        status: 'issued',
        emitter: 'ml-external',
        externalId: pdfDoc.id,
        folio,
        emittedAt: new Date(pdfDoc.date),
        attempts: 1,
        metadata: {
          source: 'ml-audit',
          orderId: String(packOrOrderId),
          allDocs: mlDocs,
          importedAt: new Date().toISOString(),
        } as any,
      },
    })
    imported++
    if (imported % 25 === 0) {
      console.log(`  importados ${imported} (procesadas ${i}/${orders.length})`)
    }
    await new Promise((r) => setTimeout(r, 100))
  }

  console.log('\n===== RESULTADO =====')
  console.log(`Total revisadas:           ${orders.length}`)
  console.log(`Importadas (ml-external):  ${imported}`)
  console.log(`Sin DTE en ML:             ${mlEmpty}`)
  console.log(`Errores:                   ${errors}`)

  await prisma.$disconnect()
}
run().catch((e) => { console.error(e?.response?.data || e?.message); process.exit(1) })
