// Borra TaxDocs Bsale específicos por folio (los de prueba con declareSii=false
// que terminaron cancelled). NO toca Bsale ni SII.
//
// Por defecto DRY-RUN. Pasar --apply para borrar.

import { PrismaClient } from '@prisma/client'

const APPLY = process.argv.includes('--apply')

// Folios de prueba a borrar (cancelled, declareSii=false en su momento).
const FOLIOS_TO_DELETE: Array<{ type: 'boleta' | 'factura'; folio: string }> = [
  { type: 'factura', folio: '1585' },
  { type: 'factura', folio: '1586' },
  { type: 'factura', folio: '1587' },
  { type: 'factura', folio: '1588' },
  { type: 'factura', folio: '1589' },
  { type: 'boleta', folio: '16925' },
  { type: 'boleta', folio: '16926' },
  { type: 'boleta', folio: '16927' },
  { type: 'boleta', folio: '16931' },
]

async function run() {
  const prisma = new PrismaClient()

  const docs = await prisma.taxDocument.findMany({
    where: {
      emitter: 'bsale',
      OR: FOLIOS_TO_DELETE.map((f) => ({ type: f.type, folio: f.folio })),
    },
    include: { lines: true, sale: { select: { saleNumber: true } } },
  })

  console.log(`Encontrados ${docs.length} de ${FOLIOS_TO_DELETE.length} esperados`)
  for (const d of docs) {
    console.log(
      `  ${d.type.padEnd(8)} folio=${d.folio} status=${d.status.padEnd(10)} sale=${d.sale?.saleNumber} lines=${d.lines.length}`,
    )
  }

  // Verificar que NO hay TaxDocuments NC apuntando a estos como reference.
  // Si los borramos y hay NC apuntando, dejaríamos NCs huérfanas.
  const ids = docs.map((d) => d.id)
  const ncReferences = await prisma.taxDocument.findMany({
    where: { referenceDocumentId: { in: ids } },
    select: { id: true, type: true, status: true, referenceDocumentId: true },
  })
  if (ncReferences.length > 0) {
    console.log()
    console.log('⚠️  Hay TaxDocs que referencian estos como original:')
    for (const r of ncReferences) {
      console.log(`  ${r.type} ${r.status} → references ${r.referenceDocumentId}`)
    }
    console.log('  Se les setea referenceDocumentId = null antes de borrar.')
  }

  if (!APPLY) {
    console.log('\nDRY-RUN. Para borrar: pasar --apply')
    process.exit(0)
  }

  console.log('\nBorrando...')
  // 1. Limpiar referenceDocumentId en NCs que apunten a estos
  if (ncReferences.length > 0) {
    await prisma.taxDocument.updateMany({
      where: { referenceDocumentId: { in: ids } },
      data: { referenceDocumentId: null },
    })
    console.log(`  ${ncReferences.length} NC desreferenciadas`)
  }
  // 2. Borrar lines
  const lines = await prisma.taxDocumentLine.deleteMany({
    where: { taxDocumentId: { in: ids } },
  })
  console.log(`  ${lines.count} lines borradas`)
  // 3. Borrar docs
  const deleted = await prisma.taxDocument.deleteMany({
    where: { id: { in: ids } },
  })
  console.log(`  ${deleted.count} docs borrados`)

  await prisma.$disconnect()
}
run().catch((e) => { console.error(e); process.exit(1) })
