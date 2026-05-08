// Audita NC: cuáles son automáticas vs manuales y si hay cancelaciones
// pendientes de NC.
import { PrismaClient } from '@prisma/client'

async function run() {
  const prisma = new PrismaClient()
  const billing = await prisma.connection.findFirst({ where: { type: 'billing' } })
  const emitFromDate = (billing?.config as any)?.emitFromDate
    ? new Date((billing!.config as any).emitFromDate)
    : null
  const autoEmit = (billing?.config as any)?.autoEmit
  console.log(`autoEmit=${autoEmit} emitFromDate=${emitFromDate?.toISOString() || 'none'}`)
  console.log()

  // 1. Todas las NC issued
  const ncs = await prisma.taxDocument.findMany({
    where: { type: 'nota_credito', status: 'issued', emitter: 'bsale' },
    orderBy: { createdAt: 'asc' },
    include: {
      sale: { select: { saleNumber: true, placedAt: true } },
      reference: { select: { folio: true, type: true, createdAt: true } },
    },
  })
  console.log(`=== NC Bsale issued: ${ncs.length} ===`)
  for (const nc of ncs) {
    const placed = nc.sale?.placedAt?.toISOString().slice(0, 19) || '-'
    const created = nc.createdAt.toISOString().slice(0, 19)
    const ref = nc.reference
      ? `${nc.reference.type}#${nc.reference.folio || '-'} (${nc.reference.createdAt.toISOString().slice(0, 19)})`
      : '-'
    const candAuto = emitFromDate && nc.sale?.placedAt && nc.sale.placedAt >= emitFromDate
    console.log(
      `  sale=${nc.sale?.saleNumber} placed=${placed} ncCreated=${created} ref=${ref} ${candAuto ? '[CAND-AUTO]' : '[MANUAL]'}`,
    )
  }

  console.log()
  // 2. Sales canceladas con doc emitido pero SIN NC: pendientes
  console.log(`=== Sales canceladas con doc emitido SIN NC ===`)
  const cancelled = await prisma.sale.findMany({
    where: {
      status: 'cancelled',
      taxDocuments: {
        some: { type: { in: ['boleta', 'factura'] }, status: 'issued' },
      },
    },
    include: {
      taxDocuments: { select: { id: true, type: true, status: true, folio: true } },
      orders: { select: { internalStatus: true, status: true } },
    },
  })
  let pendingNc = 0
  for (const s of cancelled) {
    const hasNc = s.taxDocuments.some((d) => d.type === 'nota_credito' && d.status === 'issued')
    if (hasNc) continue
    pendingNc++
    const docs = s.taxDocuments.map((d) => `${d.type}/${d.status}/${d.folio || '-'}`).join(', ')
    const internalStates = [...new Set(s.orders.map((o) => o.internalStatus))].join(',')
    const channelStates = [...new Set(s.orders.map((o) => o.status))].join(',')
    console.log(
      `  sale=${s.saleNumber} placed=${s.placedAt?.toISOString().slice(0, 19) || '-'} docs=[${docs}] internal=${internalStates} channel=${channelStates}`,
    )
  }
  console.log(`Total pendientes: ${pendingNc}`)

  console.log()
  // 3. Sales con orders cancelled_internal pero status sale != cancelled
  console.log(`=== Orders cancelled_internal con doc emitido SIN NC ===`)
  const orders = await prisma.order.findMany({
    where: {
      internalStatus: 'cancelled_internal',
      sale: {
        taxDocuments: {
          some: { type: { in: ['boleta', 'factura'] }, status: 'issued' },
        },
      },
    },
    include: {
      sale: {
        include: {
          taxDocuments: { select: { type: true, status: true, folio: true } },
        },
      },
    },
  })
  let pendingFromOrder = 0
  for (const o of orders) {
    const hasNc = o.sale?.taxDocuments.some(
      (d) => d.type === 'nota_credito' && d.status === 'issued',
    )
    if (hasNc) continue
    pendingFromOrder++
    const docs = o.sale?.taxDocuments
      .map((d) => `${d.type}/${d.status}/${d.folio || '-'}`)
      .join(', ')
    console.log(`  order=${o.orderNumber} sale=${o.sale?.saleNumber} docs=[${docs}]`)
  }
  console.log(`Total: ${pendingFromOrder}`)

  await prisma.$disconnect()
}
run().catch((e) => { console.error(e); process.exit(1) })
