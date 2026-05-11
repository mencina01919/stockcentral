// Reporte de cobertura de órdenes ML: cuántas hay en DB, gaps de fechas,
// última orden importada, primera, distribución por mes.
import { PrismaClient } from '@prisma/client'

async function run() {
  const prisma = new PrismaClient()
  const conn = await prisma.connection.findFirst({ where: { provider: 'mercadolibre' } })
  if (!conn) { console.log('NO_ML_CONN'); process.exit(1) }
  console.log(`ML connection: ${conn.id}`)
  console.log(`lastSync: ${conn.lastSync}`)
  console.log()

  const total = await prisma.order.count({
    where: { tenantId: conn.tenantId, source: 'mercadolibre' },
  })
  console.log(`Total órdenes ML en DB: ${total}`)

  const oldest = await prisma.order.findFirst({
    where: { tenantId: conn.tenantId, source: 'mercadolibre', placedAt: { not: null } },
    orderBy: { placedAt: 'asc' },
    select: { placedAt: true, externalOrderId: true, customerName: true },
  })
  const newest = await prisma.order.findFirst({
    where: { tenantId: conn.tenantId, source: 'mercadolibre', placedAt: { not: null } },
    orderBy: { placedAt: 'desc' },
    select: { placedAt: true, externalOrderId: true, customerName: true },
  })
  console.log(`\nMás antigua: ${oldest?.placedAt?.toISOString().slice(0, 10)} (${oldest?.externalOrderId})`)
  console.log(`Más reciente: ${newest?.placedAt?.toISOString().slice(0, 10)} (${newest?.externalOrderId})`)

  // Distribución por mes (últimos 12 meses)
  const orders = await prisma.order.findMany({
    where: { tenantId: conn.tenantId, source: 'mercadolibre', placedAt: { not: null } },
    select: { placedAt: true, status: true },
    orderBy: { placedAt: 'desc' },
    take: 5000,
  })
  const byMonth = new Map<string, { total: number; cancelled: number }>()
  for (const o of orders) {
    const k = o.placedAt!.toISOString().slice(0, 7)
    const e = byMonth.get(k) || { total: 0, cancelled: 0 }
    e.total++
    if (o.status === 'cancelled') e.cancelled++
    byMonth.set(k, e)
  }
  console.log(`\nDistribución por mes:`)
  const months = Array.from(byMonth.entries()).sort(([a], [b]) => b.localeCompare(a)).slice(0, 12)
  for (const [m, c] of months) {
    console.log(`  ${m}: ${c.total} órdenes (${c.cancelled} canceladas)`)
  }

  // Orders huérfanas (sin sale o sin items)
  const withoutSale = await prisma.order.count({
    where: { tenantId: conn.tenantId, source: 'mercadolibre', saleId: null },
  })
  const withoutItems = await prisma.order.count({
    where: { tenantId: conn.tenantId, source: 'mercadolibre', items: { none: {} } },
  })
  console.log(`\nÓrdenes sin sale vinculada: ${withoutSale}`)
  console.log(`Órdenes sin items: ${withoutItems}`)

  // Últimos 3 syncLogs de orders inbound
  const recentSyncs = await prisma.syncLog.findMany({
    where: { connectionId: conn.id, action: 'sync_orders' },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { createdAt: true, status: true, errorMessage: true, responseData: true },
  })
  console.log(`\nÚltimos 5 sync_orders:`)
  for (const l of recentSyncs) {
    const r = (l.responseData as any) || {}
    const summary = r.synced !== undefined ? `synced=${r.synced} errors=${r.errors || 0}` : ''
    console.log(`  ${l.createdAt.toISOString().slice(0, 19)} ${l.status} ${summary} ${l.errorMessage ? '| ' + l.errorMessage : ''}`)
  }

  await prisma.$disconnect()
}
run().catch((e) => { console.error(e?.message || e); process.exit(1) })
