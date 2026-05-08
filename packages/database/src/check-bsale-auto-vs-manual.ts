import { PrismaClient } from '@prisma/client'

async function run() {
  const prisma = new PrismaClient()
  const billing = await prisma.connection.findFirst({
    where: { type: 'billing' },
  })
  const emitFromDate = (billing?.config as any)?.emitFromDate
    ? new Date((billing!.config as any).emitFromDate)
    : null
  console.log(`emitFromDate: ${emitFromDate?.toISOString() || 'none'}`)
  console.log()

  const docs = await prisma.taxDocument.findMany({
    where: { emitter: 'bsale', status: 'issued' },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      type: true,
      folio: true,
      createdAt: true,
      sale: { select: { saleNumber: true, placedAt: true, createdAt: true } },
    },
  })

  // Heurística: si placedAt >= emitFromDate, es candidato a auto-emit.
  // Si NO, fue emitido manualmente sí o sí (porque el listener lo skip-ea).
  let autoCandidates = 0
  let manualOnly = 0
  const autos: any[] = []
  const manuals: any[] = []
  for (const d of docs) {
    const placed = d.sale?.placedAt
    if (emitFromDate && placed && placed >= emitFromDate) {
      autoCandidates++
      autos.push(d)
    } else {
      manualOnly++
      manuals.push(d)
    }
  }
  console.log(`Total Bsale issued: ${docs.length}`)
  console.log(`  Candidatos a AUTO-emit (placedAt >= emitFromDate): ${autoCandidates}`)
  console.log(`  Solo MANUAL (placedAt anterior a emitFromDate o sin placedAt): ${manualOnly}`)
  console.log()
  console.log('=== AUTO-emit candidatos ===')
  for (const d of autos) {
    const placed = d.sale?.placedAt?.toISOString().slice(0, 19) || '-'
    const emitted = d.createdAt.toISOString().slice(0, 19)
    const lag = d.sale?.placedAt
      ? Math.round((d.createdAt.getTime() - d.sale.placedAt.getTime()) / 60000)
      : null
    console.log(
      `  ${d.type.padEnd(13)} folio=${(d.folio || '-').padEnd(8)} sale=${d.sale?.saleNumber} placed=${placed} emitted=${emitted} lag=${lag}min`,
    )
  }
  console.log()
  console.log('=== Solo MANUAL (los que viste tú) ===')
  for (const d of manuals.slice(0, 20)) {
    const placed = d.sale?.placedAt?.toISOString().slice(0, 19) || '-'
    const emitted = d.createdAt.toISOString().slice(0, 19)
    console.log(
      `  ${d.type.padEnd(13)} folio=${(d.folio || '-').padEnd(8)} sale=${d.sale?.saleNumber} placed=${placed} emitted=${emitted}`,
    )
  }
  if (manuals.length > 20) console.log(`  ... y ${manuals.length - 20} más`)

  await prisma.$disconnect()
}
run().catch((e) => { console.error(e); process.exit(1) })
