// Preview (NO borra nada): lista los TaxDocs Bsale creados AYER
// para confirmar antes de borrar.

import { PrismaClient } from '@prisma/client'

async function run() {
  const prisma = new PrismaClient()
  // "Ayer" = todo lo creado el 2026-05-07 hora Chile (UTC-4).
  // Rango UTC: 2026-05-07T04:00:00Z hasta 2026-05-08T03:59:59Z
  const from = new Date('2026-05-07T04:00:00Z')
  const to = new Date('2026-05-08T04:00:00Z')

  const docs = await prisma.taxDocument.findMany({
    where: {
      emitter: 'bsale',
      createdAt: { gte: from, lt: to },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      type: true,
      status: true,
      folio: true,
      externalId: true,
      emittedAt: true,
      createdAt: true,
      sale: { select: { saleNumber: true, total: true } },
      lines: { select: { id: true } },
    },
  })

  const byStatus: Record<string, number> = {}
  const byType: Record<string, number> = {}
  for (const d of docs) {
    byStatus[d.status] = (byStatus[d.status] || 0) + 1
    byType[d.type] = (byType[d.type] || 0) + 1
  }

  console.log(`Total TaxDocs Bsale del 2026-05-07 (Chile): ${docs.length}`)
  console.log(`  Por status:`, byStatus)
  console.log(`  Por type:`, byType)
  console.log()
  console.log('Detalle:')
  for (const d of docs) {
    console.log(
      `  ${d.type.padEnd(13)} ${d.status.padEnd(10)} folio=${(d.folio || '-').padEnd(8)} ext=${d.externalId || '-'} sale=${d.sale?.saleNumber || '-'} created=${d.createdAt.toISOString().slice(0, 19)} lines=${d.lines.length}`,
    )
  }
  await prisma.$disconnect()
}
run()
