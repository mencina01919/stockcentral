// Lista TaxDocs emitidos por Bsale (no manuales, no ml-external).
// Distingue entre auto-emit (encolados por listener) y manual (operator).
import { PrismaClient } from '@prisma/client'

async function run() {
  const prisma = new PrismaClient()
  const docs = await prisma.taxDocument.findMany({
    where: { emitter: 'bsale' },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      type: true,
      status: true,
      folio: true,
      externalId: true,
      emittedAt: true,
      createdAt: true,
      metadata: true,
      sale: { select: { saleNumber: true, total: true, source: true, placedAt: true } },
    },
  })

  console.log(`Total TaxDocs Bsale: ${docs.length}`)
  console.log()
  for (const d of docs) {
    const meta = (d.metadata as any) || {}
    const trigger = meta.triggeredBy || meta.source || '?'
    console.log(
      `  ${d.type.padEnd(13)} ${d.status.padEnd(10)} folio=${(d.folio || '-').padEnd(8)} sale=${d.sale?.saleNumber?.padEnd(12) || '-           '} src=${d.sale?.source?.padEnd(12) || '-           '} created=${d.createdAt.toISOString().slice(0, 19)} trigger=${trigger}`,
    )
  }

  await prisma.$disconnect()
}
run().catch((e) => { console.error(e); process.exit(1) })
