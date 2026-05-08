// Backfill metadata.statusDetail / tags / hasMediations para órdenes ML que
// están en status=cancelled. Permite distinguir mediación / reclamo / no
// entregado / devolución de cancelación normal en la UI.
//
// Uso: ts-node backfill-ml-status-detail.ts [--apply]
//   sin --apply: dry-run (cuenta cuántas se actualizarían).

import { PrismaClient } from '@prisma/client'

const APPLY = process.argv.includes('--apply')

async function run() {
  const prisma = new PrismaClient()
  const conn = await prisma.connection.findFirst({ where: { provider: 'mercadolibre' } })
  if (!conn) { console.log('NO_ML_CONN'); process.exit(1) }
  const token = (conn.credentials as any).accessToken
  const fetchOrder = async (id: string) => {
    const res = await fetch(`https://api.mercadolibre.com/orders/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }

  const orders = await prisma.order.findMany({
    where: { source: 'mercadolibre', status: 'cancelled' },
    select: { id: true, externalOrderId: true, metadata: true },
    orderBy: { placedAt: 'desc' },
  })
  console.log(`Cancelled ML orders: ${orders.length}`)

  const counts = {
    mediation: 0,
    claim: 0,
    notDelivered: 0,
    returned: 0,
    plain: 0,
    failed: 0,
  }

  let i = 0
  for (const order of orders) {
    i++
    if (!order.externalOrderId) continue
    let data: any
    try {
      data = await fetchOrder(order.externalOrderId)
    } catch (err: any) {
      counts.failed++
      if (i % 25 === 0) process.stdout.write(`.${i}`)
      continue
    }
    const tags: string[] = Array.isArray(data.tags) ? data.tags : []
    const statusDetail: string | null = data.status_detail || null
    const hasMediations = Array.isArray(data.mediations) && data.mediations.length > 0

    if (hasMediations || tags.includes('mediations') || statusDetail === 'mediation_open') counts.mediation++
    else if (tags.includes('claim_opened') || tags.includes('claim')) counts.claim++
    else if (tags.includes('not_delivered') || statusDetail === 'not_delivered') counts.notDelivered++
    else if (tags.includes('return') || tags.includes('returned') || statusDetail === 'returned') counts.returned++
    else counts.plain++

    if (APPLY) {
      const base = (order.metadata && typeof order.metadata === 'object' ? order.metadata : {}) as Record<string, unknown>
      await prisma.order.update({
        where: { id: order.id },
        data: {
          metadata: { ...base, statusDetail, tags, hasMediations },
        },
      })
    }
    if (i % 25 === 0) process.stdout.write(`.${i}`)
  }
  console.log()
  console.log('Resumen:')
  console.log(`  Mediación:     ${counts.mediation}`)
  console.log(`  Reclamo:       ${counts.claim}`)
  console.log(`  No entregado:  ${counts.notDelivered}`)
  console.log(`  Devolución:    ${counts.returned}`)
  console.log(`  Sin marcas:    ${counts.plain}`)
  console.log(`  ML 4xx/5xx:    ${counts.failed}`)
  if (!APPLY) console.log('\nDRY-RUN. Para escribir: pasar --apply')

  await prisma.$disconnect()
}
run().catch((e) => { console.error(e); process.exit(1) })
