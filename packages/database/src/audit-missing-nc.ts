// Audita sales canceladas (internalStatus=cancelled_internal en alguna order)
// que tienen un TaxDocument (boleta/factura) issued sin NC que lo referencie.
// Estos son los casos donde la cancelación NO disparó NC automática por el
// bug del processor (idempotencia "1 NC por sale" en vez de "1 NC por
// documento original").
import { PrismaClient } from '@prisma/client'

async function run() {
  const prisma = new PrismaClient()
  // Sales con al menos una order cancelled_internal
  const sales = await prisma.sale.findMany({
    where: {
      orders: { some: { internalStatus: 'cancelled_internal' } },
    },
    include: {
      taxDocuments: {
        select: {
          id: true, type: true, status: true, folio: true,
          referenceDocumentId: true, createdAt: true, emitter: true,
        },
      },
    },
  })

  const pending: Array<{
    saleNumber: string
    saleId: string
    docId: string
    docType: string
    folio: string | null
  }> = []

  for (const s of sales) {
    // Solo boletas/facturas issued emitidas por Bsale (las de otros emitters
    // — ml-external, manual — no se anulan por NC: son referencias a docs
    // emitidos fuera del sistema, sin folio Bsale real).
    const issuedDocs = s.taxDocuments.filter(
      (d) => (d.type === 'boleta' || d.type === 'factura') &&
             d.status === 'issued' &&
             d.emitter === 'bsale',
    )
    if (issuedDocs.length === 0) continue
    // Notas de crédito existentes (issued o pending) y a qué documento original referencian
    const ncs = s.taxDocuments.filter(
      (d) => d.type === 'nota_credito' && (d.status === 'issued' || d.status === 'pending'),
    )
    const referencedByNc = new Set(ncs.map((nc) => nc.referenceDocumentId).filter(Boolean))

    for (const doc of issuedDocs) {
      if (!referencedByNc.has(doc.id)) {
        // No hay NC que apunte a este doc — pendiente
        pending.push({
          saleNumber: s.saleNumber,
          saleId: s.id,
          docId: doc.id,
          docType: doc.type,
          folio: doc.folio,
        })
      }
    }
  }

  console.log(`Sales canceladas con doc issued sin NC: ${pending.length}\n`)
  for (const p of pending) {
    console.log(`  ${p.saleNumber} → ${p.docType} folio=${p.folio || '-'} id=${p.docId.slice(0, 8)}…`)
  }
  await prisma.$disconnect()
}
run().catch((e) => { console.error(e?.message || e); process.exit(1) })
