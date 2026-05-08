// Backfill placedAt para Falabella y Lider re-fetcheando cada orden de la
// API y tomando la fecha real (Falabella: CreatedAt, Lider: orderDate).
// Como son pocas órdenes (16 total), iteramos una por una sin paginación.

import { PrismaClient } from '@prisma/client'
import { FalabellaDriver, LiderDriver } from '@stockcentral/integrations'

async function run() {
  const prisma = new PrismaClient()

  for (const provider of ['falabella', 'lider']) {
    const conn = await prisma.connection.findFirst({ where: { provider } })
    if (!conn) { console.log(`${provider}: sin conexión`); continue }

    const credentials = conn.credentials as Record<string, string>
    const config = (conn.config || {}) as Record<string, unknown>
    const driver: any = provider === 'falabella' ? new FalabellaDriver() : new LiderDriver()

    const orders = await prisma.order.findMany({
      where: { source: provider },
      select: { id: true, externalOrderId: true, saleId: true, placedAt: true },
    })
    console.log(`\n=== ${provider} (${orders.length} órdenes) ===`)

    let updated = 0
    let skipped = 0
    const affectedSales = new Set<string>()
    for (const order of orders) {
      if (!order.externalOrderId) { skipped++; continue }
      try {
        const result = await driver.getOrder(credentials, order.externalOrderId, config)
        if (!result || !result.createdAt) { skipped++; continue }
        const realDate = new Date(result.createdAt)
        const same = order.placedAt && Math.abs(order.placedAt.getTime() - realDate.getTime()) < 60_000
        if (same) continue
        await prisma.order.update({
          where: { id: order.id },
          data: { placedAt: realDate },
        })
        if (order.saleId) affectedSales.add(order.saleId)
        updated++
      } catch (err: any) {
        console.log(`  ${order.externalOrderId}: ERROR ${err?.response?.status || ''} ${err?.message?.slice(0, 100)}`)
        skipped++
      }
    }
    console.log(`  ${updated} actualizadas, ${skipped} omitidas`)

    // Recalc Sale.placedAt
    for (const saleId of affectedSales) {
      const ords = await prisma.order.findMany({
        where: { saleId },
        select: { placedAt: true },
      })
      const dates = ords.map((o) => o.placedAt).filter((d): d is Date => !!d)
      if (dates.length === 0) continue
      const earliest = new Date(Math.min(...dates.map((d) => d.getTime())))
      await prisma.sale.update({ where: { id: saleId }, data: { placedAt: earliest } })
    }
    console.log(`  ${affectedSales.size} sales recalculadas`)
  }

  await prisma.$disconnect()
}
run().catch((e) => { console.error(e); process.exit(1) })
