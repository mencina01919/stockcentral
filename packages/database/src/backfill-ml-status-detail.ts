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

  // Por defecto procesa cancelled. Pasar --paid para procesar también las
  // pagadas (necesario para detectar delivered_no_shipping en órdenes paid
  // antiguas marcadas no_delivered en metadata).
  const INCLUDE_PAID = process.argv.includes('--paid')
  const orders = await prisma.order.findMany({
    where: {
      source: 'mercadolibre',
      status: INCLUDE_PAID ? { in: ['cancelled', 'paid', 'confirmed'] } : 'cancelled',
    },
    select: { id: true, externalOrderId: true, metadata: true },
    orderBy: { placedAt: 'desc' },
  })
  console.log(`ML orders to revisit: ${orders.length}`)

  const counts = {
    mediation: 0,
    claim: 0,
    notDelivered: 0,
    returned: 0,
    deliveredNoShipping: 0,
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
    let statusDetail: string | null = data.status_detail || null
    const hasMediationsRaw = Array.isArray(data.mediations) && data.mediations.length > 0
    const hasCancelDetail = data.cancel_detail && typeof data.cancel_detail === 'object'
    // mediación realmente abierta: array no vacío + tag 'mediations'/'mediation'
    // + sin cancel_detail. Si falta el tag, la mediación está cerrada aunque
    // el array siga listándola (caso reso. a favor del seller, retiro del comprador).
    const hasMediationTag = tags.includes('mediations') || tags.includes('mediation')
    const hasMediations = hasMediationsRaw && hasMediationTag && !hasCancelDetail
    if (!statusDetail && hasCancelDetail) {
      const group = String(data.cancel_detail.group || '').toLowerCase()
      const requestedBy = String(data.cancel_detail.requested_by || '').toLowerCase()
      if (group === 'buyer') statusDetail = 'cancelled_by_buyer'
      else if (group === 'seller') statusDetail = 'cancelled_by_seller'
      else if (group === 'ml' || group === 'mercadolibre') statusDetail = 'cancelled_by_ml'
      else if (group === 'delivery') {
        if (requestedBy === 'seller') statusDetail = 'cancelled_by_seller'
        else if (requestedBy === 'buyer') statusDetail = 'cancelled_by_buyer'
        else statusDetail = 'cancelled_by_delivery'
      } else if (group) statusDetail = `cancelled_by_${group}`
    }
    // Caso no_shipping cumplido: si el seller dejó feedback, ML lo da por
    // entregado aunque el tag not_delivered siga.
    const isNoShipping = tags.includes('no_shipping')
    const sellerLeftFeedback = !!data.feedback?.seller?.id
    if (
      !statusDetail &&
      isNoShipping &&
      data.status === 'paid' &&
      !hasCancelDetail &&
      sellerLeftFeedback
    ) {
      statusDetail = 'delivered_no_shipping'
    }

    if (hasMediations || statusDetail === 'mediation_open') counts.mediation++
    else if (tags.includes('claim_opened') || tags.includes('claim')) counts.claim++
    else if (tags.includes('return') || tags.includes('returned') || statusDetail === 'returned') counts.returned++
    else if (statusDetail === 'delivered_no_shipping') counts.deliveredNoShipping++
    else if (statusDetail?.startsWith('cancelled_by_')) counts.plain++
    else if (tags.includes('not_delivered') || statusDetail === 'not_delivered') counts.notDelivered++
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
  console.log(`  Mediación:           ${counts.mediation}`)
  console.log(`  Reclamo:             ${counts.claim}`)
  console.log(`  No entregado:        ${counts.notDelivered}`)
  console.log(`  Devolución:          ${counts.returned}`)
  console.log(`  Entregado no_shipping: ${counts.deliveredNoShipping}`)
  console.log(`  Sin marcas:          ${counts.plain}`)
  console.log(`  ML 4xx/5xx:          ${counts.failed}`)
  if (!APPLY) console.log('\nDRY-RUN. Para escribir: pasar --apply')

  await prisma.$disconnect()
}
run().catch((e) => { console.error(e); process.exit(1) })
