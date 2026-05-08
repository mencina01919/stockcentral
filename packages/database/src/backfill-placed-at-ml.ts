// Re-fetchea órdenes ML de los últimos N días directamente desde la API
// para corregir placedAt con la fecha real (date_created).
// Los demás campos NO se tocan — solo placedAt.
//
// Uso: ts-node backfill-placed-at-ml.ts [days]   (default: 10)

import { PrismaClient } from '@prisma/client'
import axios from 'axios'

const DAYS = Number(process.argv[2] || 10)

async function run() {
  const prisma = new PrismaClient()
  const conn = await prisma.connection.findFirst({ where: { provider: 'mercadolibre' } })
  if (!conn) { console.log('NO_ML_CONN'); process.exit(1) }
  const creds = (conn.credentials as any) || {}
  const token = creds.accessToken
  const sellerId = creds.sellerId
  if (!token || !sellerId) { console.log('NO_TOKEN_OR_SELLER'); process.exit(1) }

  const c = axios.create({
    baseURL: 'https://api.mercadolibre.com',
    headers: { Authorization: `Bearer ${token}` },
    timeout: 20000,
  })

  // Fetch las orders de los últimos N días desde ML, paginado.
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000)
  console.log(`Re-fetching ML orders desde ${since.toISOString()} (${DAYS} días)...`)

  const updates: Array<{ externalOrderId: string; placedAt: Date }> = []
  let offset = 0
  const limit = 50
  while (true) {
    const res = await c.get('/orders/search', {
      params: {
        seller: sellerId,
        offset,
        limit,
        sort: 'date_desc',
        'date_created.from': since.toISOString(),
      },
    })
    const items: any[] = res.data?.results || []
    for (const o of items) {
      if (o.id && o.date_created) {
        updates.push({
          externalOrderId: String(o.id),
          placedAt: new Date(o.date_created),
        })
      }
    }
    const total = res.data?.paging?.total ?? 0
    console.log(`  fetched ${updates.length}/${total}`)
    if (offset + limit >= total) break
    offset += limit
  }

  console.log(`\nActualizando ${updates.length} órdenes en local...`)
  let updated = 0
  let notFound = 0
  const affectedSaleIds = new Set<string>()
  for (const u of updates) {
    const order = await prisma.order.findFirst({
      where: { source: 'mercadolibre', externalOrderId: u.externalOrderId },
      select: { id: true, saleId: true, placedAt: true },
    })
    if (!order) { notFound++; continue }
    // Solo actualizamos si la fecha es distinta (evita updates innecesarios).
    if (order.placedAt && Math.abs(order.placedAt.getTime() - u.placedAt.getTime()) < 1000) continue
    await prisma.order.update({
      where: { id: order.id },
      data: { placedAt: u.placedAt },
    })
    if (order.saleId) affectedSaleIds.add(order.saleId)
    updated++
  }
  console.log(`  ${updated} órdenes con placedAt real`)
  console.log(`  ${notFound} no encontradas en local`)
  console.log(`  ${affectedSaleIds.size} sales afectadas (necesitan recalcular Sale.placedAt)`)

  // Recalcular Sale.placedAt = min(orders.placedAt)
  if (affectedSaleIds.size > 0) {
    console.log('\nRecalculando Sale.placedAt...')
    let recalc = 0
    for (const saleId of affectedSaleIds) {
      const orders = await prisma.order.findMany({
        where: { saleId },
        select: { placedAt: true },
      })
      const dates = orders.map((o) => o.placedAt).filter((d): d is Date => !!d)
      if (dates.length === 0) continue
      const earliest = new Date(Math.min(...dates.map((d) => d.getTime())))
      await prisma.sale.update({
        where: { id: saleId },
        data: { placedAt: earliest },
      })
      recalc++
    }
    console.log(`  ${recalc} sales recalculadas`)
  }

  await prisma.$disconnect()
}
run().catch((e) => { console.error(e?.response?.data || e?.message); process.exit(1) })
