// Borra TaxDocs Bsale que NO tienen folio asignado (drafts que nunca
// emitieron documento real en Bsale). Tipicamente son:
//  - status='failed' (nunca llegó a /documents.json)
//  - status='cancelled' que se marcaron antes de emitir (drafts internos)
// Los que tienen folio (aunque estén cancelled) se mantienen porque sí
// existieron en Bsale/SII en algún momento.
//
// Por defecto hace DRY-RUN (solo lista). Pasar `--apply` para borrar.

import { PrismaClient } from '@prisma/client'

const APPLY = process.argv.includes('--apply')

async function run() {
  const prisma = new PrismaClient()

  // Borramos SOLO drafts: sin folio Y sin externalId. Los que tienen
  // externalId fueron emitidos en Bsale aunque su folio local sea null
  // (caso típico de NCs donde el folio queda en credit_note.id).
  const docs = await prisma.taxDocument.findMany({
    where: {
      emitter: 'bsale',
      AND: [
        { OR: [{ folio: null }, { folio: '' }] },
        { OR: [{ externalId: null }, { externalId: '' }] },
      ],
    },
    select: {
      id: true,
      type: true,
      status: true,
      folio: true,
      externalId: true,
      createdAt: true,
      lastError: true,
      sale: { select: { saleNumber: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`TaxDocs Bsale SIN folio: ${docs.length}`)
  console.log()
  for (const d of docs) {
    const err = d.lastError ? ` err="${d.lastError.slice(0, 60)}"` : ''
    console.log(
      `  ${d.type.padEnd(13)} ${d.status.padEnd(10)} ext=${d.externalId || '-'} sale=${d.sale?.saleNumber || '-'} created=${d.createdAt.toISOString().slice(0, 19)}${err}`,
    )
  }

  if (!APPLY) {
    console.log()
    console.log('DRY-RUN. Para borrar: pasar --apply')
    process.exit(0)
  }

  console.log()
  console.log('Borrando...')
  const ids = docs.map((d) => d.id)
  // Borrar lines primero (ON DELETE CASCADE no garantizado dependiendo del schema)
  const linesDeleted = await prisma.taxDocumentLine.deleteMany({
    where: { taxDocumentId: { in: ids } },
  })
  const docsDeleted = await prisma.taxDocument.deleteMany({
    where: { id: { in: ids } },
  })
  console.log(`  Lines borradas: ${linesDeleted.count}`)
  console.log(`  Docs borrados:  ${docsDeleted.count}`)

  await prisma.$disconnect()
}
run().catch((e) => { console.error(e); process.exit(1) })
